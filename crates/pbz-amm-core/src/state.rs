// Copyright 2026 PBZ-AMM Contributors
// SPDX-License-Identifier: Apache-2.0

use crate::backup::{BackupPolicy, SaveBackupRecord};
use crate::container::ContainerIndex;
use crate::error::{AmmError, Result};
use crate::scanner::{DeployTarget, ModCategory, StagedFileEntry};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};

pub const VANILLA_PROFILE_ID: &str = "vanilla";
pub const DEFAULT_PROFILE_ID: &str = "default";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModVersionData {
    pub version: String,
    pub variant_name: String,
    pub vault_rel_dir: String,
    pub categories: Vec<ModCategory>,
    pub files: Vec<StagedFileEntry>,
    pub containers: Vec<ContainerIndex>,
    pub writes_ue4ss_enabled_txt: Vec<String>,
    pub ue4ss_mod_names: Vec<String>,
    pub pbz_loader_mod_names: Vec<String>,
    pub has_ue4ss_cpp_dll: bool,
    pub installed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledMod {
    pub id: String,
    pub name: String,
    pub nexus_mod_id: Option<u32>,
    pub latest_remote_version: Option<String>,
    pub current: ModVersionData,
    /// Retained previous version for instant one-click rollback if an update misbehaves.
    pub previous: Option<ModVersionData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileEntry {
    pub mod_id: String,
    pub enabled: bool,
    /// Priority order (higher loads later / overrides earlier in `~mods` when needed).
    pub priority: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModProfile {
    pub id: String,
    pub display_name: String,
    pub description: String,
    pub entries: Vec<ProfileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeployedFileRecord {
    pub mod_id: String,
    pub target: DeployTarget,
    pub target_rel: String,
    /// Absolute or game-root-relative path placed on disk.
    pub game_rel_path: String,
    pub sha256: String,
    pub is_user_config: bool,
    pub hardlinked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnmanagedCandidate {
    pub id: String,
    pub name: String,
    pub target: DeployTarget,
    pub game_rel_paths: Vec<String>,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagerState {
    pub schema_version: u32,
    pub game_root: Option<PathBuf>,
    pub active_profile_id: String,
    pub profiles: BTreeMap<String, ModProfile>,
    pub mods: BTreeMap<String, InstalledMod>,
    pub deployed_files: Vec<DeployedFileRecord>,
    pub managed_ue4ss_enabled_markers: Vec<String>,
    pub save_backups: Vec<SaveBackupRecord>,
    pub backup_policy: BackupPolicy,
}

impl Default for ManagerState {
    fn default() -> Self {
        let mut profiles = BTreeMap::new();
        profiles.insert(
            VANILLA_PROFILE_ID.to_string(),
            ModProfile {
                id: VANILLA_PROFILE_ID.to_string(),
                display_name: "纯净原版".to_string(),
                description: "不启用任何受管 Mod（保留存档共用，用于排错或纯净游玩）".to_string(),
                entries: Vec::new(),
            },
        );
        profiles.insert(
            DEFAULT_PROFILE_ID.to_string(),
            ModProfile {
                id: DEFAULT_PROFILE_ID.to_string(),
                display_name: "默认配置".to_string(),
                description: "日常游玩的默认 Mod 组合".to_string(),
                entries: Vec::new(),
            },
        );

        Self {
            schema_version: 1,
            game_root: None,
            active_profile_id: DEFAULT_PROFILE_ID.to_string(),
            profiles,
            mods: BTreeMap::new(),
            deployed_files: Vec::new(),
            managed_ue4ss_enabled_markers: Vec::new(),
            save_backups: Vec::new(),
            backup_policy: BackupPolicy::default(),
        }
    }
}

/// Exclusive OS file lock ensuring CLI, GUI, and MCP never mutate manager state concurrently.
pub struct DataDirLock {
    _file: File,
}

impl DataDirLock {
    pub fn acquire(data_dir: &Path) -> Result<Self> {
        fs::create_dir_all(data_dir)?;
        let lock_path = data_dir.join(".pbz-amm.lock");
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(lock_path)?;
        file.try_lock().map_err(|_| AmmError::StateLocked)?;
        Ok(Self { _file: file })
    }
}

pub fn load_state(data_dir: &Path) -> Result<ManagerState> {
    let state_path = data_dir.join("state.json");
    if !state_path.is_file() {
        return Ok(ManagerState::default());
    }
    let raw = fs::read_to_string(&state_path)?;
    let state: ManagerState = serde_json::from_str(&raw)?;
    Ok(state)
}

pub fn save_state_atomic(data_dir: &Path, state: &ManagerState) -> Result<()> {
    fs::create_dir_all(data_dir)?;
    let state_path = data_dir.join("state.json");
    let tmp_path = data_dir.join("state.json.tmp");
    let json = serde_json::to_string_pretty(state)?;
    fs::write(&tmp_path, json)?;
    fs::rename(&tmp_path, &state_path)?;
    Ok(())
}
