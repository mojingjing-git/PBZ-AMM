// Copyright 2026 PBZ-AMM Contributors
// SPDX-License-Identifier: Apache-2.0

use crate::backup::{create_save_backup, restore_save_backup};
use crate::container::{AssetConflict, find_container_conflicts};
use crate::error::{AmmError, Result, SelectionPrompt};
use crate::game::GameInstall;
use crate::scanner::{
    DeployTarget, ModCategory, ScanReport, ScannedVariant, extract_source_to_dir,
    scan_extracted_dir, sha256_file,
};
use crate::state::{
    DEFAULT_PROFILE_ID, DataDirLock, DeployedFileRecord, InstalledMod, ManagerState, ModProfile,
    ModVersionData, ProfileEntry, UnmanagedCandidate, VANILLA_PROFILE_ID, load_state,
    save_state_atomic,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const UE4SS_BUILTIN_MODS: &[&str] = &[
    "bpml_genericfunctions",
    "bpmodloadermod",
    "bplogicmodloader",
    "cheatmanagerenablermod",
    "consolecommandsmod",
    "consoleenablermod",
    "jsbprofiler",
    "keybinds",
    "linetracemod",
    "splitscreenmod",
    "shared",
];

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct InstallOptions {
    pub mod_id_override: Option<String>,
    pub name_override: Option<String>,
    pub nexus_mod_id: Option<u32>,
    pub version_override: Option<String>,
    pub select_variant: Option<String>,
    pub allow_conflicts: bool,
    pub allow_uncertain_files: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConflictSummary {
    pub file_conflicts: Vec<String>,
    pub asset_conflicts: Vec<AssetConflict>,
    pub unmanaged_collisions: Vec<String>,
}

impl ConflictSummary {
    pub fn is_empty(&self) -> bool {
        self.file_conflicts.is_empty()
            && self.asset_conflicts.is_empty()
            && self.unmanaged_collisions.is_empty()
    }

    pub fn to_messages(&self) -> Vec<String> {
        let mut msgs = Vec::new();
        for fc in &self.file_conflicts {
            msgs.push(format!("文件级冲突: {fc}"));
        }
        for uc in &self.unmanaged_collisions {
            msgs.push(format!("已存在未接管的同名外部文件（拒绝直接覆盖）: {uc}"));
        }
        for ac in &self.asset_conflicts {
            if !ac.overlapping_assets.is_empty() {
                let preview = ac
                    .overlapping_assets
                    .iter()
                    .take(3)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", ");
                msgs.push(format!(
                    "容器资产冲突 ({} <-> {}): 重叠资产 {} 项 (如 {})",
                    ac.mod_a,
                    ac.mod_b,
                    ac.overlapping_assets.len(),
                    preview
                ));
            } else {
                msgs.push(format!(
                    "IoStore 块指纹冲突 ({} <-> {}): 重叠 {} 个 FIoChunkId 数据块",
                    ac.mod_a, ac.mod_b, ac.overlapping_chunks
                ));
            }
        }
        msgs
    }
}

pub struct ModManager {
    data_dir: PathBuf,
    _lock: DataDirLock,
    pub state: ManagerState,
    allow_small_exe_for_tests: bool,
}

impl ModManager {
    pub fn open(data_dir: impl AsRef<Path>) -> Result<Self> {
        Self::open_internal(data_dir.as_ref(), false)
    }

    pub fn open_for_tests(data_dir: impl AsRef<Path>) -> Result<Self> {
        Self::open_internal(data_dir.as_ref(), true)
    }

    fn open_internal(data_dir: &Path, allow_small_exe_for_tests: bool) -> Result<Self> {
        let lock = DataDirLock::acquire(data_dir)?;
        let state = load_state(data_dir)?;
        Ok(Self {
            data_dir: data_dir.to_path_buf(),
            _lock: lock,
            state,
            allow_small_exe_for_tests,
        })
    }

    pub fn vault_dir(&self) -> PathBuf {
        self.data_dir.join("vault")
    }

    pub fn backups_dir(&self) -> PathBuf {
        self.data_dir.join("backups")
    }

    pub fn downloads_dir(&self) -> PathBuf {
        self.data_dir.join("downloads")
    }

    pub fn save(&self) -> Result<()> {
        save_state_atomic(&self.data_dir, &self.state)
    }

    /// Resolve and bind the Phantom Blade Zero installation directory.
    pub fn resolve_game(&mut self, override_root: Option<&Path>) -> Result<GameInstall> {
        let install = if let Some(root) = override_root {
            GameInstall::from_root(root, self.allow_small_exe_for_tests)?
        } else if let Some(saved) = &self.state.game_root {
            GameInstall::from_root(saved, self.allow_small_exe_for_tests)?
        } else {
            GameInstall::auto_discover()?
        };

        if self.state.game_root.as_deref() != Some(install.root_dir.as_path()) {
            self.state.game_root = Some(install.root_dir.clone());
            self.save()?;
        }
        Ok(install)
    }

    /// Preview a local archive/folder without modifying the game or manager state.
    pub fn inspect_source(
        &self,
        source: &Path,
        game: Option<&GameInstall>,
    ) -> Result<(ScanReport, BTreeMap<String, ConflictSummary>)> {
        let temp = tempfile::tempdir_in(self.ensure_temp_root()?)?;
        extract_source_to_dir(source, temp.path())?;
        let label = source
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("mod");
        let fw = game.map(GameInstall::detect_frameworks);
        let report = scan_extracted_dir(temp.path(), label, fw.as_ref())?;

        let mut variant_conflicts = BTreeMap::new();
        if let Some(g) = game {
            let candidate_id = slugify_id(&report.suggested_name);
            for v in &report.variants {
                let summary = self.compute_conflicts_for_candidate(g, &candidate_id, v);
                variant_conflicts.insert(v.name.clone(), summary);
            }
        }
        Ok((report, variant_conflicts))
    }

    /// Install a new mod or update an existing mod (preserving previous version for rollback & keeping user configs).
    pub fn install_source(
        &mut self,
        game: &GameInstall,
        source: &Path,
        opts: &InstallOptions,
    ) -> Result<InstalledMod> {
        game.ensure_game_closed()?;

        let temp = tempfile::tempdir_in(self.ensure_temp_root()?)?;
        extract_source_to_dir(source, temp.path())?;
        let label = source
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("mod");
        let fw = game.detect_frameworks();
        let report = scan_extracted_dir(temp.path(), label, Some(&fw))?;

        if report.variants.is_empty() {
            return Err(AmmError::ArchiveError {
                path: source.display().to_string(),
                reason: "未在压缩包内识别出任何可安装的《影之刃零》Mod 文件".to_string(),
            });
        }

        // 1. Variant selection gate (Stop-on-Ambiguity)
        let chosen: ScannedVariant = if report.variants.len() == 1 {
            let only = &report.variants[0];
            if let Some(req) = &opts.select_variant
                && !only.name.eq_ignore_ascii_case(req)
            {
                return Err(AmmError::NeedsSelection(Box::new(SelectionPrompt {
                    reason: format!("未找到名为 `{req}` 的变体"),
                    available_variants: vec![only.name.clone()],
                    conflicts: Vec::new(),
                    uncertain_files: Vec::new(),
                })));
            }
            only.clone()
        } else {
            match &opts.select_variant {
                Some(req) => report
                    .variants
                    .iter()
                    .find(|v| v.name.eq_ignore_ascii_case(req))
                    .cloned()
                    .ok_or_else(|| {
                        AmmError::NeedsSelection(Box::new(SelectionPrompt {
                            reason: format!("请从多个可选变体中指定一个 (`--select <变体名>`)，未找到 `{req}`"),
                            available_variants: report.variants.iter().map(|v| v.name.clone()).collect(),
                            conflicts: Vec::new(),
                            uncertain_files: Vec::new(),
                        }))
                    })?,
                None => {
                    return Err(AmmError::NeedsSelection(Box::new(SelectionPrompt {
                        reason: "该压缩包包含多个互斥可选变体，请指定要安装的变体".to_string(),
                        available_variants: report.variants.iter().map(|v| v.name.clone()).collect(),
                        conflicts: Vec::new(),
                        uncertain_files: Vec::new(),
                    })));
                }
            }
        };

        if !chosen.problems.is_empty() {
            return Err(AmmError::ArchiveError {
                path: source.display().to_string(),
                reason: chosen.problems.join("；"),
            });
        }

        if chosen.files.is_empty() {
            return Err(AmmError::ArchiveError {
                path: source.display().to_string(),
                reason: "所选变体内没有可部署的有效文件".to_string(),
            });
        }

        // 2. Uncertain DLL / file gate
        let uncertain_list: Vec<String> = chosen
            .files
            .iter()
            .filter(|f| f.uncertain)
            .map(|f| format!("{:?}: {}", f.target, f.target_rel))
            .collect();
        if !uncertain_list.is_empty() && !opts.allow_uncertain_files {
            return Err(AmmError::NeedsSelection(Box::new(SelectionPrompt {
                reason: "安装包包含未知用途的 DLL 文件，需确认后方可放入主程序目录 (`--allow-uncertain`)".to_string(),
                available_variants: vec![chosen.name.clone()],
                conflicts: Vec::new(),
                uncertain_files: uncertain_list,
            })));
        }

        let display_name = opts
            .name_override
            .clone()
            .unwrap_or_else(|| report.suggested_name.clone());
        let mod_id = opts
            .mod_id_override
            .clone()
            .unwrap_or_else(|| slugify_id(&display_name));

        // 3. Conflict & Unmanaged-Overwrite gate!
        let conflict_summary = self.compute_conflicts_for_candidate(game, &mod_id, &chosen);
        // Unmanaged file collision is ALWAYS blocked unless adopted first or explicitly forced;
        // Mod-to-mod conflicts pause for confirmation unless `allow_conflicts` is true.
        if !conflict_summary.unmanaged_collisions.is_empty()
            || (!conflict_summary.is_empty() && !opts.allow_conflicts)
        {
            return Err(AmmError::NeedsSelection(Box::new(SelectionPrompt {
                reason: if !conflict_summary.unmanaged_collisions.is_empty() {
                    "目标路径存在未经本工具接管的已有文件，为避免破坏原有环境已暂停（请先运行 `adopt` 接管或处理）".to_string()
                } else {
                    "检测到与当前启用 Mod 存在文件或内部资产冲突，请确认是否继续覆盖 (`--allow-conflicts`)".to_string()
                },
                available_variants: vec![chosen.name.clone()],
                conflicts: conflict_summary.to_messages(),
                uncertain_files: Vec::new(),
            })));
        }

        // 4. Auto-backup saves before installing script/blueprint/exe mods!
        let touches_logic = chosen.categories.iter().any(|c| {
            !matches!(c, ModCategory::Pak | ModCategory::IoStore)
        });
        if touches_logic {
            let bdir = self.backups_dir();
            let _ = create_save_backup(
                game,
                &bdir,
                &mut self.state.save_backups,
                &self.state.backup_policy,
                &format!("安装/更新功能型 Mod `{display_name}` 前自动备份"),
                None,
                false,
            )?;
        }

        // 5. Stage files into Vault (`vault/<mod_id>/<slot_timestamp>/`), preserving user configs on update!
        let now = Utc::now();
        let version_str = opts
            .version_override
            .clone()
            .unwrap_or_else(|| now.format("local-%Y%m%d%H%M%S").to_string());
        let slot_name = format!("v-{}", now.format("%Y%m%d-%H%M%S-%3f"));
        let vault_rel = format!("{mod_id}/{slot_name}");
        let slot_abs = self.vault_dir().join(&mod_id).join(&slot_name);
        fs::create_dir_all(&slot_abs)?;

        // Sync any live user-modified config files from existing deployment before rotating!
        self.capture_live_user_configs(game, &mod_id)?;

        let mut finalized_files = Vec::with_capacity(chosen.files.len());
        for mut f in chosen.files {
            let src_file = temp.path().join(&f.source_rel);
            let vault_dest = slot_abs.join(&f.source_rel);
            if let Some(p) = vault_dest.parent() {
                fs::create_dir_all(p)?;
            }
            fs::copy(&src_file, &vault_dest)?;

            // If updating an existing mod and user had customized this config file, carry over user's config!
            if f.is_user_config
                && let Some(existing) = self.state.mods.get(&mod_id)
                && let Some(prev_cfg) = existing.current.files.iter().find(|pf| {
                    pf.is_user_config
                        && pf.target == f.target
                        && pf.target_rel.eq_ignore_ascii_case(&f.target_rel)
                })
            {
                let old_cfg_path = self
                    .vault_dir()
                    .join(&existing.current.vault_rel_dir)
                    .join(&prev_cfg.source_rel);
                if old_cfg_path.is_file() {
                    fs::copy(&old_cfg_path, &vault_dest)?;
                    f.sha256 = sha256_file(&vault_dest)?;
                    f.size_bytes = fs::metadata(&vault_dest)?.len();
                }
            }
            finalized_files.push(f);
        }

        let new_version_data = ModVersionData {
            version: version_str,
            variant_name: chosen.name,
            vault_rel_dir: vault_rel,
            categories: chosen.categories,
            files: finalized_files,
            containers: chosen.containers,
            writes_ue4ss_enabled_txt: chosen.writes_ue4ss_enabled_txt,
            ue4ss_mod_names: chosen.ue4ss_mod_names,
            pbz_loader_mod_names: chosen.pbz_loader_mod_names,
            has_ue4ss_cpp_dll: chosen.has_ue4ss_cpp_dll,
            installed_at: now,
        };

        let previous_slot = if let Some(mut old_mod) = self.state.mods.remove(&mod_id) {
            // Garbage-collect superseded `previous` directory so we keep current + 1 rollback version cleanly
            if let Some(expired) = old_mod.previous.take() {
                let _ = fs::remove_dir_all(self.vault_dir().join(&expired.vault_rel_dir));
            }
            Some(old_mod.current)
        } else {
            None
        };

        let nexus_id = opts.nexus_mod_id.or(report.nexus_mod_id_hint);
        let record = InstalledMod {
            id: mod_id.clone(),
            name: display_name,
            nexus_mod_id: nexus_id,
            latest_remote_version: None,
            current: new_version_data,
            previous: previous_slot,
        };
        self.state.mods.insert(mod_id.clone(), record.clone());

        // Add to active profile (unless active profile is `vanilla`, in which case add to `default` and switch or enable on active)
        let target_profile = if self.state.active_profile_id == VANILLA_PROFILE_ID {
            DEFAULT_PROFILE_ID.to_string()
        } else {
            self.state.active_profile_id.clone()
        };
        if let Some(prof) = self.state.profiles.get_mut(&target_profile)
            && !prof.entries.iter().any(|e| e.mod_id == mod_id)
        {
            let next_prio = prof
                .entries
                .iter()
                .map(|e| e.priority)
                .max()
                .unwrap_or(0)
                + 10;
            prof.entries.push(ProfileEntry {
                mod_id: mod_id.clone(),
                enabled: true,
                priority: next_prio,
            });
        }

        self.reconcile_deployment(game)?;
        self.save()?;
        Ok(record)
    }

    /// Roll back a mod to its retained previous version.
    pub fn rollback_mod(&mut self, game: &GameInstall, mod_id: &str) -> Result<InstalledMod> {
        game.ensure_game_closed()?;
        self.capture_live_user_configs(game, mod_id)?;

        let vdir = self.vault_dir();
        let m = self
            .state
            .mods
            .get_mut(mod_id)
            .ok_or_else(|| AmmError::ModNotFound(mod_id.to_string()))?;
        let prev = m
            .previous
            .take()
            .ok_or_else(|| AmmError::NoRollbackVersion(mod_id.to_string()))?;

        let broken_current = std::mem::replace(&mut m.current, prev);
        let updated = m.clone();
        let _ = fs::remove_dir_all(vdir.join(&broken_current.vault_rel_dir));

        self.reconcile_deployment(game)?;
        self.save()?;
        Ok(updated)
    }

    /// Enable or disable a mod within the currently active profile (if on `vanilla`, switches to `default` first on enable).
    pub fn set_mod_enabled(
        &mut self,
        game: &GameInstall,
        mod_id: &str,
        enabled: bool,
    ) -> Result<()> {
        game.ensure_game_closed()?;
        if !self.state.mods.contains_key(mod_id) {
            return Err(AmmError::ModNotFound(mod_id.to_string()));
        }
        if enabled && self.state.active_profile_id == VANILLA_PROFILE_ID {
            self.state.active_profile_id = DEFAULT_PROFILE_ID.to_string();
        }
        let prof_id = self.state.active_profile_id.clone();
        let prof = self
            .state
            .profiles
            .get_mut(&prof_id)
            .ok_or_else(|| AmmError::ProfileNotFound(prof_id))?;

        if let Some(entry) = prof.entries.iter_mut().find(|e| e.mod_id == mod_id) {
            entry.enabled = enabled;
        } else if enabled {
            let next_prio = prof.entries.iter().map(|e| e.priority).max().unwrap_or(0) + 10;
            prof.entries.push(ProfileEntry {
                mod_id: mod_id.to_string(),
                enabled: true,
                priority: next_prio,
            });
        }

        self.reconcile_deployment(game)?;
        self.save()
    }

    /// Completely remove a managed mod from all profiles, game directories, and the staging vault.
    pub fn uninstall_mod(&mut self, game: &GameInstall, mod_id: &str) -> Result<()> {
        game.ensure_game_closed()?;
        let removed = self
            .state
            .mods
            .remove(mod_id)
            .ok_or_else(|| AmmError::ModNotFound(mod_id.to_string()))?;

        for prof in self.state.profiles.values_mut() {
            prof.entries.retain(|e| e.mod_id != mod_id);
        }

        self.reconcile_deployment(game)?;
        let _ = fs::remove_dir_all(self.vault_dir().join(&removed.id));
        self.save()
    }

    /// Create a new Mod Profile (optionally cloning the current profile's mod list).
    pub fn create_profile(
        &mut self,
        id: &str,
        display_name: &str,
        description: &str,
        clone_active: bool,
    ) -> Result<ModProfile> {
        let clean_id = slugify_id(id);
        let entries = if clone_active {
            self.state
                .profiles
                .get(&self.state.active_profile_id)
                .map(|p| p.entries.clone())
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        let profile = ModProfile {
            id: clean_id.clone(),
            display_name: display_name.to_string(),
            description: description.to_string(),
            entries,
        };
        self.state.profiles.insert(clean_id, profile.clone());
        self.save()?;
        Ok(profile)
    }

    /// Switch to another Profile (e.g. `vanilla` / `default` / `practice`).
    /// Leaves `SaveGames` shared and untouched, while automatically backing up saves before the switch.
    pub fn switch_profile(&mut self, game: &GameInstall, profile_id: &str) -> Result<ModProfile> {
        game.ensure_game_closed()?;
        if !self.state.profiles.contains_key(profile_id) {
            return Err(AmmError::ProfileNotFound(profile_id.to_string()));
        }

        let bdir = self.backups_dir();
        let _ = create_save_backup(
            game,
            &bdir,
            &mut self.state.save_backups,
            &self.state.backup_policy,
            &format!("切换配置方案至 `{profile_id}` 前自动备份"),
            None,
            false,
        )?;

        self.state.active_profile_id = profile_id.to_string();
        self.reconcile_deployment(game)?;
        self.save()?;
        Ok(self.state.profiles[profile_id].clone())
    }

    /// Scan the game installation for pre-existing mods not yet managed by PBZ-AMM.
    pub fn scan_unmanaged_mods(&self, game: &GameInstall) -> Result<Vec<UnmanagedCandidate>> {
        let managed_paths: BTreeSet<String> = self
            .state
            .deployed_files
            .iter()
            .map(|d| d.game_rel_path.replace('\\', "/").to_ascii_lowercase())
            .chain(
                self.state
                    .managed_ue4ss_enabled_markers
                    .iter()
                    .map(|m| m.replace('\\', "/").to_ascii_lowercase()),
            )
            .collect();

        let mut candidates = Vec::new();

        // 1. Scan `~mods` and `LogicMods` (group IoStore .pak/.utoc/.ucas by stem!)
        for (dir, target) in [
            (&game.tilde_mods_dir, DeployTarget::TildeMods),
            (&game.logic_mods_dir, DeployTarget::LogicMods),
        ] {
            if !dir.is_dir() {
                continue;
            }
            let mut groups: BTreeMap<String, (Vec<String>, u64)> = BTreeMap::new();
            for entry in WalkDir::new(dir).min_depth(1) {
                let entry = entry.map_err(|e| std::io::Error::other(e.to_string()))?;
                if !entry.file_type().is_file() {
                    continue;
                }
                let game_rel = entry
                    .path()
                    .strip_prefix(&game.root_dir)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                if managed_paths.contains(&game_rel.to_ascii_lowercase()) {
                    continue;
                }
                let stem = entry
                    .path()
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown")
                    .to_string();
                let len = entry.metadata().map(|m| m.len()).unwrap_or(0);
                let g = groups.entry(stem).or_default();
                g.0.push(game_rel);
                g.1 += len;
            }
            for (stem, (paths, total_bytes)) in groups {
                candidates.push(UnmanagedCandidate {
                    id: slugify_id(&format!("adopted-{stem}")),
                    name: stem,
                    target,
                    game_rel_paths: paths,
                    total_bytes,
                });
            }
        }

        // Subfolders already deployed by a managed Mod stay owned by that Mod even if runtime logs/caches are written inside them
        let mut managed_subfolders: BTreeSet<(DeployTarget, String)> = BTreeSet::new();
        for d in &self.state.deployed_files {
            if let Some((top, _)) = d.target_rel.replace('\\', "/").split_once('/') {
                managed_subfolders.insert((d.target, top.to_ascii_lowercase()));
            }
        }

        // 2. Scan folder-based script mods (`ue4ss/Mods`, `PBZModLoader/mods`, `PBZModsMenu/Mods`)
        for (dir, target, filter_builtins) in [
            (&game.ue4ss_mods_dir, DeployTarget::Ue4ssMods, true),
            (&game.pbz_mod_loader_mods_dir, DeployTarget::PbzModLoaderMods, false),
            (&game.mods_menu_mods_dir, DeployTarget::ModsMenuMods, false),
        ] {
            if !dir.is_dir() {
                continue;
            }
            for sub in fs::read_dir(dir)?.flatten() {
                let sub_path = sub.path();
                if !sub_path.is_dir() {
                    continue;
                }
                let folder_name = sub.file_name().to_string_lossy().to_string();
                let folder_low = folder_name.to_ascii_lowercase();
                if filter_builtins && UE4SS_BUILTIN_MODS.contains(&folder_low.as_str()) {
                    continue;
                }
                if managed_subfolders.contains(&(target, folder_low)) {
                    continue;
                }
                let mut rels = Vec::new();
                let mut bytes = 0u64;
                for entry in WalkDir::new(&sub_path).min_depth(1) {
                    let entry = entry.map_err(|e| std::io::Error::other(e.to_string()))?;
                    if !entry.file_type().is_file() {
                        continue;
                    }
                    let game_rel = entry
                        .path()
                        .strip_prefix(&game.root_dir)
                        .unwrap()
                        .to_string_lossy()
                        .replace('\\', "/");
                    if managed_paths.contains(&game_rel.to_ascii_lowercase()) {
                        continue;
                    }
                    bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
                    rels.push(game_rel);
                }
                if !rels.is_empty() {
                    candidates.push(UnmanagedCandidate {
                        id: slugify_id(&format!("adopted-{folder_name}")),
                        name: folder_name,
                        target,
                        game_rel_paths: rels,
                        total_bytes: bytes,
                    });
                }
            }
        }

        Ok(candidates)
    }

    /// Adopt selected pre-existing wild mods into PBZ-AMM's Vault and active Profile safely.
    pub fn adopt_unmanaged_mods(
        &mut self,
        game: &GameInstall,
        candidate_ids: &[String],
    ) -> Result<Vec<InstalledMod>> {
        game.ensure_game_closed()?;
        let candidates = self.scan_unmanaged_mods(game)?;
        let selected: Vec<UnmanagedCandidate> = if candidate_ids.iter().any(|s| s == "all") {
            candidates
        } else {
            candidates
                .into_iter()
                .filter(|c| candidate_ids.iter().any(|id| id == &c.id || id == &c.name))
                .collect()
        };

        if selected.is_empty() {
            return Ok(Vec::new());
        }

        let bdir = self.backups_dir();
        let _ = create_save_backup(
            game,
            &bdir,
            &mut self.state.save_backups,
            &self.state.backup_policy,
            "接管已有野生 Mod 前自动备份",
            None,
            false,
        )?;

        let mut adopted = Vec::new();
        for cand in selected {
            let temp = tempfile::tempdir_in(self.ensure_temp_root()?)?;
            // Reconstruct relative tree inside temp dir so `install_source` classifies it identically,
            // then remove the original unmanaged files RIGHT BEFORE re-deploying managed links!
            for rel in &cand.game_rel_paths {
                let abs = game.root_dir.join(rel);
                if abs.is_file() {
                    let staged = temp.path().join(rel);
                    if let Some(p) = staged.parent() {
                        fs::create_dir_all(p)?;
                    }
                    fs::copy(&abs, &staged)?;
                }
            }
            for rel in &cand.game_rel_paths {
                let abs = game.root_dir.join(rel);
                let _ = fs::remove_file(&abs);
            }

            let opts = InstallOptions {
                mod_id_override: Some(cand.id.clone()),
                name_override: Some(cand.name.clone()),
                nexus_mod_id: None,
                version_override: Some("adopted".to_string()),
                select_variant: None,
                allow_conflicts: true,
                allow_uncertain_files: true,
            };
            let m = self.install_source(game, temp.path(), &opts)?;
            adopted.push(m);
        }

        Ok(adopted)
    }

    /// Analyze all conflicts among currently enabled mods in the active profile.
    pub fn check_active_conflicts(&self) -> ConflictSummary {
        let enabled_ids = self.active_enabled_mod_ids();
        let mut file_map: BTreeMap<(DeployTarget, String), Vec<String>> = BTreeMap::new();
        let mut container_inputs = Vec::new();

        for id in &enabled_ids {
            if let Some(m) = self.state.mods.get(id) {
                for f in &m.current.files {
                    file_map
                        .entry((f.target, f.target_rel.to_ascii_lowercase()))
                        .or_default()
                        .push(m.name.clone());
                }
                if !m.current.containers.is_empty() {
                    container_inputs.push((m.name.clone(), m.current.containers.clone()));
                }
            }
        }

        let mut file_conflicts = Vec::new();
        for ((target, rel), owners) in file_map {
            if owners.len() > 1 {
                file_conflicts.push(format!(
                    "[{target:?}] `{rel}` 被多个 Mod 同时覆盖: {}",
                    owners.join(", ")
                ));
            }
        }

        let asset_conflicts = find_container_conflicts(&container_inputs);
        ConflictSummary {
            file_conflicts,
            asset_conflicts,
            unmanaged_collisions: Vec::new(),
        }
    }

    pub fn manual_backup(
        &mut self,
        game: &GameInstall,
        note: Option<String>,
        pinned: bool,
    ) -> Result<Option<crate::backup::SaveBackupRecord>> {
        let bdir = self.backups_dir();
        let res = create_save_backup(
            game,
            &bdir,
            &mut self.state.save_backups,
            &self.state.backup_policy,
            "手动创建备份",
            note,
            pinned,
        )?;
        self.save()?;
        Ok(res)
    }

    pub fn restore_backup(
        &mut self,
        game: &GameInstall,
        backup_id: &str,
        confirmed: bool,
    ) -> Result<crate::backup::SaveBackupRecord> {
        let bdir = self.backups_dir();
        let res = restore_save_backup(
            game,
            &bdir,
            &mut self.state.save_backups,
            &self.state.backup_policy,
            backup_id,
            confirmed,
        )?;
        self.save()?;
        Ok(res)
    }

    fn compute_conflicts_for_candidate(
        &self,
        game: &GameInstall,
        candidate_mod_id: &str,
        variant: &ScannedVariant,
    ) -> ConflictSummary {
        let mut file_conflicts = Vec::new();
        let mut unmanaged_collisions = Vec::new();

        let managed_by_this_or_other: BTreeMap<String, String> = self
            .state
            .deployed_files
            .iter()
            .map(|d| {
                (
                    d.game_rel_path.replace('\\', "/").to_ascii_lowercase(),
                    d.mod_id.clone(),
                )
            })
            .collect();

        for f in &variant.files {
            let dest_abs = resolve_target_base(game, f.target).join(&f.target_rel);
            if dest_abs.is_file()
                && let Ok(rel) = dest_abs.strip_prefix(&game.root_dir)
            {
                let rel_norm = rel.to_string_lossy().replace('\\', "/").to_ascii_lowercase();
                if !managed_by_this_or_other.contains_key(&rel_norm) {
                    unmanaged_collisions.push(rel.to_string_lossy().replace('\\', "/"));
                }
            }
        }

        let enabled_ids: Vec<String> = self
            .active_enabled_mod_ids()
            .into_iter()
            .filter(|id| id != candidate_mod_id)
            .collect();

        for id in &enabled_ids {
            if let Some(other) = self.state.mods.get(id) {
                for cf in &variant.files {
                    if other.current.files.iter().any(|of| {
                        of.target == cf.target
                            && of.target_rel.eq_ignore_ascii_case(&cf.target_rel)
                    }) {
                        file_conflicts.push(format!(
                            "`{}` 与已启用 Mod `{}` 部署路径冲突",
                            cf.target_rel, other.name
                        ));
                    }
                }
            }
        }

        let mut container_inputs = Vec::new();
        if !variant.containers.is_empty() {
            container_inputs.push((
                format!("[待安装] {candidate_mod_id}"),
                variant.containers.clone(),
            ));
            for id in &enabled_ids {
                if let Some(other) = self.state.mods.get(id)
                    && !other.current.containers.is_empty()
                {
                    container_inputs.push((other.name.clone(), other.current.containers.clone()));
                }
            }
        }

        let all_asset_conflicts = find_container_conflicts(&container_inputs);
        let asset_conflicts = all_asset_conflicts
            .into_iter()
            .filter(|c| c.mod_a.starts_with("[待安装]") || c.mod_b.starts_with("[待安装]"))
            .collect();

        ConflictSummary {
            file_conflicts,
            asset_conflicts,
            unmanaged_collisions,
        }
    }

    fn active_enabled_mod_ids(&self) -> Vec<String> {
        let Some(prof) = self.state.profiles.get(&self.state.active_profile_id) else {
            return Vec::new();
        };
        let mut active: Vec<&ProfileEntry> = prof.entries.iter().filter(|e| e.enabled).collect();
        active.sort_by_key(|e| e.priority);
        active.into_iter().map(|e| e.mod_id.clone()).collect()
    }

    fn capture_live_user_configs(&self, game: &GameInstall, mod_id: &str) -> Result<()> {
        let Some(installed) = self.state.mods.get(mod_id) else {
            return Ok(());
        };
        for df in &self.state.deployed_files {
            if df.mod_id == mod_id && df.is_user_config {
                let live_path = game.root_dir.join(&df.game_rel_path);
                if live_path.is_file()
                    && let Some(sf) = installed.current.files.iter().find(|f| {
                        f.target == df.target && f.target_rel.eq_ignore_ascii_case(&df.target_rel)
                    })
                {
                    let vault_cfg = self
                        .vault_dir()
                        .join(&installed.current.vault_rel_dir)
                        .join(&sf.source_rel);
                    if vault_cfg != live_path && let Ok(live_hash) = sha256_file(&live_path) {
                        if live_hash != sf.sha256 {
                            let _ = fs::copy(&live_path, &vault_cfg);
                        }
                    }
                }
            }
        }
        Ok(())
    }

    /// Reconcile the game folder cleanly to match the active profile:
    /// 1. Save any edited user config files back to Vault, then remove all previously deployed managed files & enabled.txt markers.
    /// 2. Hardlink (or copy across volumes) every enabled mod's files for the active profile.
    /// 3. Update `ue4ss/Mods/mods.txt` and `ProjectPBZ/PBZModLoader/mods.ini` cleanly without touching unmanaged lines.
    pub fn reconcile_deployment(&mut self, game: &GameInstall) -> Result<()> {
        game.ensure_game_closed()?;

        // Step 1: Capture user-modified configs and remove previously placed managed files
        let prev_mod_ids: BTreeSet<String> = self
            .state
            .deployed_files
            .iter()
            .map(|d| d.mod_id.clone())
            .collect();
        for mid in prev_mod_ids {
            let _ = self.capture_live_user_configs(game, &mid);
        }

        let mut dirs_to_prune: BTreeSet<PathBuf> = BTreeSet::new();
        for rec in self.state.deployed_files.drain(..) {
            let abs = game.root_dir.join(&rec.game_rel_path);
            if abs.is_file() {
                // Verify we never delete a file replaced by an external tool unless it's a user config we manage
                if rec.is_user_config
                    || sha256_file(&abs).is_ok_and(|h| h == rec.sha256)
                {
                    let _ = fs::remove_file(&abs);
                    if let Some(p) = abs.parent() {
                        dirs_to_prune.insert(p.to_path_buf());
                    }
                }
            }
        }

        for marker_rel in self.state.managed_ue4ss_enabled_markers.drain(..) {
            let abs = game.root_dir.join(marker_rel);
            if abs.is_file() {
                let _ = fs::remove_file(&abs);
                if let Some(p) = abs.parent() {
                    dirs_to_prune.insert(p.to_path_buf());
                }
            }
        }

        // Prune empty mod subdirectories we created (never remove root target folders themselves)
        for dir in dirs_to_prune {
            prune_empty_parents(&dir, &game.root_dir);
        }

        // Step 2: Deploy enabled mods in priority order
        let enabled_ids = self.active_enabled_mod_ids();
        let mut active_ue4ss_mods: BTreeSet<String> = BTreeSet::new();
        let mut all_known_ue4ss_mods: BTreeSet<String> = BTreeSet::new();
        let mut active_pbz_loader_mods: BTreeSet<String> = BTreeSet::new();
        let mut all_known_pbz_loader_mods: BTreeSet<String> = BTreeSet::new();

        for m in self.state.mods.values() {
            for u in &m.current.writes_ue4ss_enabled_txt {
                all_known_ue4ss_mods.insert(u.clone());
            }
            for p in &m.current.pbz_loader_mod_names {
                all_known_pbz_loader_mods.insert(p.clone());
            }
        }

        for mod_id in &enabled_ids {
            let Some(m) = self.state.mods.get(mod_id) else {
                continue;
            };
            let slot_root = self.vault_dir().join(&m.current.vault_rel_dir);

            for sf in &m.current.files {
                let src_abs = slot_root.join(&sf.source_rel);
                let base_dir = resolve_target_base(game, sf.target);
                let dest_abs = base_dir.join(&sf.target_rel);

                if let Some(parent) = dest_abs.parent() {
                    fs::create_dir_all(parent)?;
                }

                // Never overwrite an unmanaged file that appeared externally!
                if dest_abs.is_file() {
                    continue;
                }

                // For user-editable configs (`config.lua` / `config.json`), copy instead of hardlinking
                // so in-place edits or atomic rewrites by the game work predictably; for heavy assets, hardlink!
                let hardlinked = if sf.is_user_config {
                    fs::copy(&src_abs, &dest_abs)?;
                    false
                } else if fs::hard_link(&src_abs, &dest_abs).is_ok() {
                    true
                } else {
                    fs::copy(&src_abs, &dest_abs)?;
                    false
                };

                let actual_sha = if sf.is_user_config {
                    sha256_file(&dest_abs)?
                } else {
                    sf.sha256.clone()
                };

                let game_rel_path = dest_abs
                    .strip_prefix(&game.root_dir)
                    .unwrap_or(&dest_abs)
                    .to_string_lossy()
                    .replace('\\', "/");

                self.state.deployed_files.push(DeployedFileRecord {
                    mod_id: m.id.clone(),
                    target: sf.target,
                    target_rel: sf.target_rel.clone(),
                    game_rel_path,
                    sha256: actual_sha,
                    is_user_config: sf.is_user_config,
                    hardlinked,
                });
            }

            // Write `enabled.txt` ONLY for UE4SS code mods (never for Ue4ssDataFolder!)
            for umod in &m.current.writes_ue4ss_enabled_txt {
                let marker_abs = game.ue4ss_mods_dir.join(umod).join("enabled.txt");
                if let Some(p) = marker_abs.parent() {
                    fs::create_dir_all(p)?;
                }
                fs::write(&marker_abs, b"")?;
                if let Ok(rel) = marker_abs.strip_prefix(&game.root_dir) {
                    self.state
                        .managed_ue4ss_enabled_markers
                        .push(rel.to_string_lossy().replace('\\', "/"));
                }
                active_ue4ss_mods.insert(umod.clone());
            }

            for pmod in &m.current.pbz_loader_mod_names {
                active_pbz_loader_mods.insert(pmod.clone());
            }
        }

        // Step 3: Non-destructively sync `ue4ss/Mods/mods.txt` and `ProjectPBZ/PBZModLoader/mods.ini` if present
        sync_ue4ss_mods_txt(&game.ue4ss_mods_dir, &active_ue4ss_mods, &all_known_ue4ss_mods)?;
        sync_pbz_loader_ini(
            &game.pbz_mod_loader_dir,
            &active_pbz_loader_mods,
            &all_known_pbz_loader_mods,
        )?;

        Ok(())
    }

    fn ensure_temp_root(&self) -> Result<PathBuf> {
        let p = self.data_dir.join(".tmp");
        fs::create_dir_all(&p)?;
        Ok(p)
    }
}

pub fn resolve_target_base(game: &GameInstall, target: DeployTarget) -> PathBuf {
    match target {
        DeployTarget::TildeMods => game.tilde_mods_dir.clone(),
        DeployTarget::LogicMods => game.logic_mods_dir.clone(),
        DeployTarget::Ue4ssMods => game.ue4ss_mods_dir.clone(),
        DeployTarget::PbzModLoaderMods => game.pbz_mod_loader_mods_dir.clone(),
        DeployTarget::ModsMenuMods => game.mods_menu_mods_dir.clone(),
        DeployTarget::ExeFolder => game.exe_dir.clone(),
        DeployTarget::GameRoot => game.root_dir.clone(),
    }
}

pub fn slugify_id(raw: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in raw.chars() {
        if ch.is_alphanumeric() {
            for lc in ch.to_lowercase() {
                out.push(lc);
            }
            last_dash = false;
        } else if !last_dash && !out.is_empty() {
            out.push('-');
            last_dash = true;
        }
    }
    let trimmed = out.trim_matches('-');
    if trimmed.is_empty() {
        "mod-item".to_string()
    } else {
        trimmed.to_string()
    }
}

fn prune_empty_parents(start: &Path, stop_at: &Path) {
    let mut cur = Some(start);
    while let Some(dir) = cur {
        if dir == stop_at || !dir.starts_with(stop_at) {
            break;
        }
        if fs::read_dir(dir).is_ok_and(|mut it| it.next().is_none()) {
            let _ = fs::remove_dir(dir);
            cur = dir.parent();
        } else {
            break;
        }
    }
}

fn sync_ue4ss_mods_txt(
    ue4ss_mods_dir: &Path,
    enabled_mods: &BTreeSet<String>,
    all_managed_mods: &BTreeSet<String>,
) -> Result<()> {
    let mods_txt = ue4ss_mods_dir.join("mods.txt");
    if !mods_txt.is_file() && enabled_mods.is_empty() {
        return Ok(());
    }
    if !ue4ss_mods_dir.is_dir() {
        return Ok(());
    }

    let existing = if mods_txt.is_file() {
        fs::read_to_string(&mods_txt)?
    } else {
        String::new()
    };

    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut out_lines: Vec<String> = Vec::new();
    let mut keybinds_line: Option<String> = None;

    for line in existing.lines() {
        let trimmed = line.trim();
        if let Some((lhs, _rhs)) = trimmed.split_once(':') {
            let mod_name = lhs.trim();
            if mod_name.eq_ignore_ascii_case("Keybinds") {
                // UE4SS requires `Keybinds : 1` at the bottom of mods.txt if present
                keybinds_line = Some(line.to_string());
                continue;
            }
            if let Some(managed) = all_managed_mods
                .iter()
                .find(|m| m.eq_ignore_ascii_case(mod_name))
            {
                let flag = if enabled_mods.contains(managed) {
                    1
                } else {
                    0
                };
                out_lines.push(format!("{managed} : {flag}"));
                seen.insert(managed.to_ascii_lowercase());
                continue;
            }
        }
        out_lines.push(line.to_string());
    }

    for m in enabled_mods {
        if m.eq_ignore_ascii_case("Keybinds") {
            if keybinds_line.is_none() {
                keybinds_line = Some("Keybinds : 1".to_string());
            }
            continue;
        }
        if !seen.contains(&m.to_ascii_lowercase()) {
            out_lines.push(format!("{m} : 1"));
        }
    }
    if let Some(kb) = keybinds_line {
        let kb_flag = if enabled_mods.iter().any(|m| m.eq_ignore_ascii_case("Keybinds")) {
            "Keybinds : 1".to_string()
        } else if all_managed_mods.iter().any(|m| m.eq_ignore_ascii_case("Keybinds")) {
            "Keybinds : 0".to_string()
        } else {
            kb
        };
        out_lines.push(kb_flag);
    }

    if mods_txt.is_file() || !enabled_mods.is_empty() {
        fs::write(&mods_txt, out_lines.join("\r\n") + "\r\n")?;
    }
    Ok(())
}

fn sync_pbz_loader_ini(
    loader_dir: &Path,
    enabled_mods: &BTreeSet<String>,
    all_managed_mods: &BTreeSet<String>,
) -> Result<()> {
    let ini_path = loader_dir.join("mods.ini");
    if !ini_path.is_file() && all_managed_mods.is_empty() {
        return Ok(());
    }
    if !loader_dir.is_dir() {
        return Ok(());
    }

    let existing = if ini_path.is_file() {
        fs::read_to_string(&ini_path)?
    } else {
        String::new()
    };

    // PBZModLoader 2.x strictly requires `[Loader]` (`Version=1`) followed by `[Mods]`.
    let mut loader_kv: Vec<(String, String)> = Vec::new();
    let mut unmanaged_mods_lines: Vec<String> = Vec::new();
    let mut current_section = String::new();

    for line in existing.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with(';') || trimmed.starts_with('#') {
            continue;
        }
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            current_section = trimmed[1..trimmed.len() - 1].trim().to_ascii_lowercase();
            continue;
        }
        if let Some((lhs, rhs)) = trimmed.split_once('=') {
            let key = lhs.trim();
            let val = rhs.trim();
            if current_section == "loader" {
                loader_kv.push((key.to_string(), val.to_string()));
            } else {
                // Either under `[Mods]` or migrated from a legacy flat `mods.ini`
                let is_managed = all_managed_mods.iter().any(|m| m.eq_ignore_ascii_case(key));
                if !is_managed {
                    unmanaged_mods_lines.push(format!("{key}={val}"));
                }
            }
        }
    }

    let get_loader_val = |k: &str, default: &str| -> String {
        loader_kv
            .iter()
            .find(|(ek, _)| ek.eq_ignore_ascii_case(k))
            .map(|(_, ev)| ev.clone())
            .unwrap_or_else(|| default.to_string())
    };

    let mut out_lines = vec![
        "[Loader]".to_string(),
        "Version=1".to_string(),
        format!("Enabled={}", get_loader_val("Enabled", "1")),
        format!("AllowScriptPaks={}", get_loader_val("AllowScriptPaks", "1")),
        String::new(),
        "[Mods]".to_string(),
    ];

    out_lines.extend(unmanaged_mods_lines);

    for m in all_managed_mods {
        let flag = if enabled_mods.contains(m) { 1 } else { 0 };
        out_lines.push(format!("{m}={flag}"));
    }

    fs::write(&ini_path, out_lines.join("\r\n") + "\r\n")?;
    Ok(())
}
