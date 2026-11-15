// Copyright 2026 PBZ-AMM Contributors
// SPDX-License-Identifier: Apache-2.0

use crate::error::{AmmError, Result};
use crate::game::GameInstall;
use crate::scanner::{sanitize_relative_path, sha256_file};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{self};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use zip::CompressionMethod;
use zip::write::SimpleFileOptions;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveBackupRecord {
    pub id: String,
    pub created_at: DateTime<Utc>,
    pub trigger_reason: String,
    pub note: Option<String>,
    pub pinned: bool,
    pub archive_name: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub file_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupPolicy {
    /// Maximum number of unpinned automatic backups to retain.
    pub max_auto_backups: usize,
    /// Maximum cumulative disk space (bytes) for unpinned automatic backups.
    pub max_auto_bytes: u64,
}

impl Default for BackupPolicy {
    fn default() -> Self {
        Self {
            max_auto_backups: 20,
            max_auto_bytes: 2 * 1024 * 1024 * 1024, // 2 GiB
        }
    }
}

/// Create a ZIP snapshot of `<GameRoot>/ProjectPBZ/Saved/SaveGames` if saves exist on disk.
pub fn create_save_backup(
    game: &GameInstall,
    backups_dir: &Path,
    records: &mut Vec<SaveBackupRecord>,
    policy: &BackupPolicy,
    trigger_reason: &str,
    note: Option<String>,
    pinned: bool,
) -> Result<Option<SaveBackupRecord>> {
    if !game.save_games_dir.is_dir() {
        return Ok(None);
    }

    let mut save_files = Vec::new();
    for entry in WalkDir::new(&game.save_games_dir).min_depth(1) {
        let entry = entry.map_err(|e| io::Error::other(e.to_string()))?;
        if entry.file_type().is_file() {
            save_files.push(entry.path().to_path_buf());
        }
    }
    if save_files.is_empty() {
        return Ok(None);
    }

    fs::create_dir_all(backups_dir)?;
    let now = Utc::now();
    let id = format!("bak-{}", now.format("%Y%m%d-%H%M%S-%3f"));
    let archive_name = format!("{id}.zip");
    let archive_path = backups_dir.join(&archive_name);

    {
        let out = File::create(&archive_path)?;
        let mut zip = zip::ZipWriter::new(out);
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

        for fpath in &save_files {
            let rel = fpath
                .strip_prefix(&game.save_games_dir)
                .map_err(|e| io::Error::other(e.to_string()))?
                .to_string_lossy()
                .replace('\\', "/");
            zip.start_file(rel, opts)
                .map_err(|e| io::Error::other(e.to_string()))?;
            let mut src = File::open(fpath)?;
            io::copy(&mut src, &mut zip)?;
        }
        zip.finish().map_err(|e| io::Error::other(e.to_string()))?;
    }

    let size_bytes = fs::metadata(&archive_path)?.len();
    let sha256 = sha256_file(&archive_path)?;

    let record = SaveBackupRecord {
        id,
        created_at: now,
        trigger_reason: trigger_reason.to_string(),
        note,
        pinned,
        archive_name,
        size_bytes,
        sha256,
        file_count: save_files.len(),
    };
    records.push(record.clone());

    enforce_backup_quota(backups_dir, records, policy);
    Ok(Some(record))
}

/// Prune oldest UNPINNED backups when count or cumulative byte budget is exceeded.
pub fn enforce_backup_quota(
    backups_dir: &Path,
    records: &mut Vec<SaveBackupRecord>,
    policy: &BackupPolicy,
) {
    records.sort_by_key(|r| r.created_at);

    loop {
        let unpinned_indices: Vec<usize> = records
            .iter()
            .enumerate()
            .filter(|(_, r)| !r.pinned)
            .map(|(i, _)| i)
            .collect();

        let unpinned_count = unpinned_indices.len();
        let unpinned_bytes: u64 = unpinned_indices
            .iter()
            .map(|&i| records[i].size_bytes)
            .sum();

        if unpinned_count <= 1
            || (unpinned_count <= policy.max_auto_backups
                && unpinned_bytes <= policy.max_auto_bytes)
        {
            break;
        }

        let oldest_idx = unpinned_indices[0];
        let removed = records.remove(oldest_idx);
        let _ = fs::remove_file(backups_dir.join(&removed.archive_name));
    }
}

/// Restore a save snapshot back to `<GameRoot>/ProjectPBZ/Saved/SaveGames`.
/// Strictly requires:
/// 1. `confirmed == true`
/// 2. `PBZ.exe` is NOT running
/// 3. Integrity verification (SHA-256 matches recorded snapshot)
/// 4. Pre-restore emergency backup of current saves before overwriting
pub fn restore_save_backup(
    game: &GameInstall,
    backups_dir: &Path,
    records: &mut Vec<SaveBackupRecord>,
    policy: &BackupPolicy,
    backup_id: &str,
    confirmed: bool,
) -> Result<SaveBackupRecord> {
    if !confirmed {
        return Err(AmmError::RestoreConfirmationRequired);
    }
    game.ensure_game_closed()?;

    let target = records
        .iter()
        .find(|r| r.id == backup_id)
        .cloned()
        .ok_or_else(|| AmmError::BackupNotFound(backup_id.to_string()))?;

    let archive_path: PathBuf = backups_dir.join(&target.archive_name);
    if !archive_path.is_file() {
        return Err(AmmError::BackupNotFound(format!(
            "备份压缩包丢失: {}",
            archive_path.display()
        )));
    }

    let actual_hash = sha256_file(&archive_path)?;
    if actual_hash != target.sha256 {
        return Err(AmmError::ArchiveError {
            path: archive_path.display().to_string(),
            reason: "存档备份 SHA-256 校验不匹配，已中止恢复以保护当前存档".to_string(),
        });
    }

    // Safety net: snapshot current live SaveGames right before restoring!
    let _ = create_save_backup(
        game,
        backups_dir,
        records,
        policy,
        &format!("恢复备份 {backup_id} 前的自动保护快照"),
        None,
        false,
    )?;

    // Extract into temporary staging dir on same volume, then sync into SaveGames
    let temp_extract = backups_dir.join(format!(".restore-tmp-{}", target.id));
    if temp_extract.exists() {
        fs::remove_dir_all(&temp_extract)?;
    }
    fs::create_dir_all(&temp_extract)?;

    let file = File::open(&archive_path)?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| AmmError::ArchiveError {
        path: archive_path.display().to_string(),
        reason: e.to_string(),
    })?;

    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| AmmError::ArchiveError {
            path: archive_path.display().to_string(),
            reason: e.to_string(),
        })?;
        let clean = sanitize_relative_path(entry.name())?;
        if clean.as_os_str().is_empty() {
            continue;
        }
        let dest = temp_extract.join(&clean);
        if entry.is_dir() {
            fs::create_dir_all(&dest)?;
        } else {
            if let Some(p) = dest.parent() {
                fs::create_dir_all(p)?;
            }
            let mut out = File::create(&dest)?;
            io::copy(&mut entry, &mut out)?;
        }
    }

    fs::create_dir_all(&game.save_games_dir)?;
    for entry in WalkDir::new(&temp_extract).min_depth(1) {
        let entry = entry.map_err(|e| io::Error::other(e.to_string()))?;
        let rel = entry.path().strip_prefix(&temp_extract).unwrap();
        let live_dest = game.save_games_dir.join(rel);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&live_dest)?;
        } else if entry.file_type().is_file() {
            if let Some(p) = live_dest.parent() {
                fs::create_dir_all(p)?;
            }
            fs::copy(entry.path(), &live_dest)?;
        }
    }

    let _ = fs::remove_dir_all(&temp_extract);
    Ok(target)
}
