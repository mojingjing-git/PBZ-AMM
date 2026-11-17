// Copyright 2026 PBZ-AMM Contributors
// SPDX-License-Identifier: Apache-2.0

use crate::container::{ContainerIndex, inspect_container};
use crate::error::{AmmError, Result};
use crate::game::InstalledFrameworks;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use walkdir::WalkDir;

pub const KNOWN_PROXY_DLLS: &[&str] = &[
    "dwmapi.dll",
    "version.dll",
    "hid.dll",
    "dxgi.dll",
    "d3d11.dll",
    "d3d12.dll",
    "dinput8.dll",
    "dsound.dll",
    "winmm.dll",
    "winhttp.dll",
    "xinput1_3.dll",
    "xinput1_4.dll",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeployTarget {
    /// `<GameRoot>/ProjectPBZ/Content/Paks/~mods`
    TildeMods,
    /// `<GameRoot>/ProjectPBZ/Content/Paks/LogicMods`
    LogicMods,
    /// `<GameRoot>/platform/<store>/ue4ss/Mods`
    Ue4ssMods,
    /// `<GameRoot>/ProjectPBZ/PBZModLoader/mods`
    PbzModLoaderMods,
    /// `<GameRoot>/ProjectPBZ/Content/JavaScript/PBZModsMenu/Mods`
    ModsMenuMods,
    /// `<GameRoot>/platform/<store>` (next to shipping PBZ.exe)
    ExeFolder,
    /// `<GameRoot>` (project config/keybinding or ModsMenu loader files; never SaveGames)
    GameRoot,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModCategory {
    Pak,
    IoStore,
    BlueprintLogic,
    Ue4ssLua,
    Ue4ssDll,
    Ue4ssLuaAndDll,
    Ue4ssDataFolder,
    PbzModLoaderScript,
    ModsMenuScript,
    ExeProxy,
    GameFiles,
    Hybrid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StagedFileEntry {
    /// Relative path inside the extracted staging root.
    pub source_rel: String,
    /// Destination target bucket.
    pub target: DeployTarget,
    /// Relative path beneath the destination target bucket.
    pub target_rel: String,
    pub size_bytes: u64,
    pub sha256: String,
    /// If true, this file is a user-editable config (`config.lua`, `config.json`, `*.ini`) preserved across updates.
    pub is_user_config: bool,
    /// If true, placing this file requires explicit user confirmation (e.g. unrecognized DLL next to exe).
    pub uncertain: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannedVariant {
    pub name: String,
    pub categories: Vec<ModCategory>,
    pub files: Vec<StagedFileEntry>,
    pub containers: Vec<ContainerIndex>,
    pub writes_ue4ss_enabled_txt: Vec<String>,
    pub ue4ss_mod_names: Vec<String>,
    pub pbz_loader_mod_names: Vec<String>,
    pub has_ue4ss_cpp_dll: bool,
    pub warnings: Vec<String>,
    pub problems: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanReport {
    pub suggested_name: String,
    pub nexus_mod_id_hint: Option<u32>,
    pub variants: Vec<ScannedVariant>,
    pub requires_variant_choice: bool,
    pub ignored_executables: Vec<String>,
}

/// Validate a relative archive entry path to prevent Zip-Slip traversal attacks.
pub fn sanitize_relative_path(raw: &str) -> Result<PathBuf> {
    let normalized = raw.replace('\\', "/");
    let path = Path::new(&normalized);
    let mut clean = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::Normal(seg) => clean.push(seg),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(AmmError::ZipSlipDetected(raw.to_string()));
            }
        }
    }
    Ok(clean)
}

/// Unpack an archive (`.zip`, `.7z`, `.rar`), copy a single `.pak`, or mirror a raw directory into `dest_dir`.
/// Never executes any embedded binary or script.
pub fn extract_source_to_dir(source: &Path, dest_dir: &Path) -> Result<()> {
    fs::create_dir_all(dest_dir)?;
    if source.is_dir() {
        for entry in WalkDir::new(source).min_depth(1) {
            let entry = entry.map_err(|e| io::Error::other(e.to_string()))?;
            let rel = entry
                .path()
                .strip_prefix(source)
                .map_err(|e| io::Error::other(e.to_string()))?;
            let clean = sanitize_relative_path(&rel.to_string_lossy())?;
            let out = dest_dir.join(clean);
            if entry.file_type().is_dir() {
                fs::create_dir_all(&out)?;
            } else if entry.file_type().is_file() {
                if let Some(p) = out.parent() {
                    fs::create_dir_all(p)?;
                }
                fs::copy(entry.path(), &out)?;
            }
        }
        return Ok(());
    }

    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    match ext.as_str() {
        "pak" => {
            let fname = source
                .file_name()
                .ok_or_else(|| AmmError::Other("无效的文件名".to_string()))?;
            fs::copy(source, dest_dir.join(fname))?;
            Ok(())
        }
        "zip" => extract_zip(source, dest_dir),
        "7z" => extract_7z(source, dest_dir),
        "rar" => extract_rar(source, dest_dir),
        other => Err(AmmError::ArchiveError {
            path: source.display().to_string(),
            reason: format!("不支持的安装包后缀 `.{other}`（支持 .zip / .7z / .rar / .pak 或文件夹）"),
        }),
    }
}

fn extract_zip(source: &Path, dest_dir: &Path) -> Result<()> {
    let file = File::open(source)?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| AmmError::ArchiveError {
        path: source.display().to_string(),
        reason: e.to_string(),
    })?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| AmmError::ArchiveError {
            path: source.display().to_string(),
            reason: e.to_string(),
        })?;
        let clean = sanitize_relative_path(entry.name())?;
        if clean.as_os_str().is_empty() {
            continue;
        }
        let out_path = dest_dir.join(&clean);
        if entry.is_dir() {
            fs::create_dir_all(&out_path)?;
        } else {
            if let Some(p) = out_path.parent() {
                fs::create_dir_all(p)?;
            }
            let mut out_file = File::create(&out_path)?;
            io::copy(&mut entry, &mut out_file)?;
        }
    }
    Ok(())
}

fn extract_7z(source: &Path, dest_dir: &Path) -> Result<()> {
    // Pre-scan entry names with custom callback to enforce Zip-Slip protection strictly.
    let src_str = source.display().to_string();
    sevenz_rust2::decompress_file_with_extract_fn(source, dest_dir, |entry, reader, dest| {
        let clean = sanitize_relative_path(entry.name())
            .map_err(|e| sevenz_rust2::Error::from(io::Error::other(e.to_string())))?;
        if clean.as_os_str().is_empty() {
            return Ok(true);
        }
        let out_path = dest.join(clean);
        if entry.is_directory() {
            fs::create_dir_all(&out_path)?;
        } else {
            if let Some(p) = out_path.parent() {
                fs::create_dir_all(p)?;
            }
            let mut out_file = File::create(&out_path)?;
            io::copy(reader, &mut out_file)?;
        }
        Ok(true)
    })
    .map_err(|e| AmmError::ArchiveError {
        path: src_str,
        reason: e.to_string(),
    })
}

fn hidden_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

fn verify_no_extracted_symlinks(root: &Path, archive_path: &Path) -> Result<()> {
    for entry in WalkDir::new(root).follow_links(false) {
        let entry = entry.map_err(|e| AmmError::ArchiveError {
            path: archive_path.display().to_string(),
            reason: e.to_string(),
        })?;
        if entry.file_type().is_symlink() {
            return Err(AmmError::ZipSlipDetected(format!(
                "压缩包解压后包含危险符号链接: {}",
                entry.path().display()
            )));
        }
    }
    Ok(())
}

fn extract_rar(source: &Path, dest_dir: &Path) -> Result<()> {
    // Use Windows built-in System32\tar.exe (libarchive, supports RAR4 & RAR5 natively on Win10/11),
    // falling back to 7z.exe if available. Both enforce entry-path Zip-Slip validation before extraction.
    let sys_tar = PathBuf::from(r"C:\Windows\System32\tar.exe");
    let tar_cmd = if sys_tar.is_file() {
        sys_tar
    } else {
        PathBuf::from("tar")
    };

    // First list entries to enforce Zip-Slip check before extraction!
    if let Ok(list_out) = hidden_command(&tar_cmd).arg("-tf").arg(source).output()
        && list_out.status.success()
    {
        for line in String::from_utf8_lossy(&list_out.stdout).lines() {
            sanitize_relative_path(line.trim())?;
        }
        let ext_out = hidden_command(&tar_cmd)
            .arg("-xf")
            .arg(source)
            .arg("-C")
            .arg(dest_dir)
            .output()?;
        if ext_out.status.success() {
            verify_no_extracted_symlinks(dest_dir, source)?;
            return Ok(());
        }
    }

    if let Ok(list_7z) = hidden_command("7z").arg("l").arg("-slt").arg(source).output()
        && list_7z.status.success()
    {
        for line in String::from_utf8_lossy(&list_7z.stdout).lines() {
            if let Some(rel) = line.trim().strip_prefix("Path = ") {
                let norm = rel.trim();
                if norm != source.to_string_lossy() && !norm.is_empty() {
                    sanitize_relative_path(norm)?;
                }
            }
        }
        if let Ok(seven_z) = hidden_command("7z")
            .arg("x")
            .arg("-y")
            .arg(format!("-o{}", dest_dir.display()))
            .arg(source)
            .output()
            && seven_z.status.success()
        {
            verify_no_extracted_symlinks(dest_dir, source)?;
            return Ok(());
        }
    }

    Err(AmmError::ArchiveError {
        path: source.display().to_string(),
        reason: "解压 .rar 失败（Windows tar.exe 或 7z 未能解开该压缩包）".to_string(),
    })
}

pub fn sha256_file(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Extract Nexus Mod ID from standard Nexus archive naming convention `<Name>-<ModId>-<Version>-<Timestamp>.zip`.
pub fn parse_nexus_id_from_filename(filename: &str) -> Option<u32> {
    let stem = Path::new(filename).file_stem()?.to_str()?;
    let parts: Vec<&str> = stem.split('-').collect();
    if parts.len() >= 4 {
        // Walk from right: timestamp is last, version segments in middle, modId sits before version.
        // In Nexus filenames, parts[1] or parts[parts.len()-3] is typically numeric ModID.
        for candidate in parts.iter().skip(1) {
            if candidate.len() <= 7
                && candidate.chars().all(|c| c.is_ascii_digit())
                && let Ok(id) = candidate.parse::<u32>()
                && id > 0
            {
                return Some(id);
            }
        }
    }
    None
}

/// Scan an extracted staging folder and classify all PBZ mod files, variants, containers, and safety checks.
pub fn scan_extracted_dir(
    staging_root: &Path,
    source_label: &str,
    frameworks: Option<&InstalledFrameworks>,
) -> Result<ScanReport> {
    let mut raw_files: Vec<(String, PathBuf)> = Vec::new();
    let mut ignored_executables = Vec::new();

    for entry in WalkDir::new(staging_root).min_depth(1) {
        let entry = entry.map_err(|e| io::Error::other(e.to_string()))?;
        if !entry.file_type().is_file() {
            continue;
        }
        let rel = entry
            .path()
            .strip_prefix(staging_root)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");

        let lower = rel.to_ascii_lowercase();
        // Never execute or deploy standalone installer scripts/exes bundled by authors
        if lower.ends_with(".exe")
            || lower.ends_with(".cmd")
            || lower.ends_with(".bat")
            || lower.ends_with(".ps1")
        {
            ignored_executables.push(rel);
            continue;
        }
        // Ignore pure documentation / desktop noise
        let fname = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if matches!(
            fname.as_str(),
            "readme.txt" | "readme.md" | "thumbs.db" | ".ds_store"
        ) || lower.ends_with(".url")
            || lower.ends_with(".png") && !lower.contains("projectpbz/") && !lower.contains("ue4ss/")
            || lower.ends_with(".jpg") && !lower.contains("projectpbz/") && !lower.contains("ue4ss/")
        {
            continue;
        }

        raw_files.push((rel, entry.path().to_path_buf()));
    }

    // Strip a single redundant wrapper folder if every file sits under the same top-level folder
    // UNLESS that top-level folder is already a structural marker (`ProjectPBZ`, `platform`, `ue4ss`, `LogicMods`, `~mods`, `Scripts`, `dlls`).
    let stripped_prefix = detect_single_wrapper_folder(&raw_files);
    let fallback_mod_name = stripped_prefix
        .clone()
        .unwrap_or_else(|| clean_mod_title(source_label));

    // Check if top-level subfolders represent mutually exclusive user variants (e.g. "Option A", "Option B")
    let variant_groups = partition_into_variants(&raw_files, stripped_prefix.as_deref(), &fallback_mod_name)?;

    let mut variants = Vec::new();
    for (variant_name, items) in variant_groups {
        let mut built = build_variant(&variant_name, &fallback_mod_name, &items)?;
        // Check dual script-loader copy inside a single variant (both ModsMenu and PBZModLoader copies bundled!)
        let has_menu_copy = built
            .files
            .iter()
            .any(|f| f.target == DeployTarget::ModsMenuMods);
        let has_loader_copy = built
            .files
            .iter()
            .any(|f| f.target == DeployTarget::PbzModLoaderMods);

        if has_menu_copy && has_loader_copy {
            // If user only has one of the two loaders installed, auto-pick that one; otherwise split into 2 choices!
            let menu_installed = frameworks.is_some_and(|fw| fw.mods_menu && !fw.pbz_mod_loader);
            let loader_installed = frameworks.is_some_and(|fw| fw.pbz_mod_loader && !fw.mods_menu);

            if menu_installed {
                built.files.retain(|f| f.target != DeployTarget::PbzModLoaderMods);
                built.pbz_loader_mod_names.clear();
                built
                    .warnings
                    .push("检测到压缩包同时包含 Mods Menu 与 PBZModLoader 双份脚本，已根据当前环境自动选用 Mods Menu 版本".to_string());
                variants.push(built);
            } else if loader_installed {
                built.files.retain(|f| f.target != DeployTarget::ModsMenuMods);
                built
                    .warnings
                    .push("检测到压缩包同时包含 Mods Menu 与 PBZModLoader 双份脚本，已根据当前环境自动选用 PBZModLoader 版本".to_string());
                variants.push(built);
            } else {
                let mut v_menu = built.clone();
                v_menu.name = format!("{variant_name} [ModsMenu]");
                v_menu
                    .files
                    .retain(|f| f.target != DeployTarget::PbzModLoaderMods);
                v_menu.pbz_loader_mod_names.clear();

                let mut v_loader = built;
                v_loader.name = format!("{variant_name} [PBZModLoader]");
                v_loader
                    .files
                    .retain(|f| f.target != DeployTarget::ModsMenuMods);

                variants.push(v_menu);
                variants.push(v_loader);
            }
        } else {
            variants.push(built);
        }
    }

    let requires_variant_choice = variants.len() > 1;
    Ok(ScanReport {
        suggested_name: clean_mod_title(source_label),
        nexus_mod_id_hint: parse_nexus_id_from_filename(source_label),
        variants,
        requires_variant_choice,
        ignored_executables,
    })
}

fn clean_mod_title(source_label: &str) -> String {
    let stem = Path::new(source_label)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(source_label);
    // Strip trailing Nexus `-<modid>-<ver>-<timestamp>` if present
    let parts: Vec<&str> = stem.split('-').collect();
    if parts.len() >= 4
        && parts[parts.len() - 1].chars().all(|c| c.is_ascii_digit())
    {
        for idx in 1..parts.len() {
            if parts[idx].chars().all(|c| c.is_ascii_digit()) {
                return parts[..idx].join("-").trim().to_string();
            }
        }
    }
    stem.trim().to_string()
}

fn is_structural_dir(seg: &str) -> bool {
    matches!(
        seg.to_ascii_lowercase().as_str(),
        "pbz"
            | "projectpbz"
            | "platform"
            | "content"
            | "paks"
            | "~mods"
            | "logicmods"
            | "ue4ss"
            | "mods"
            | "scripts"
            | "dlls"
            | "shared"
            | "pbzmodloader"
            | "pbzmodsmenu"
            | "reshade-shaders"
    )
}

fn detect_single_wrapper_folder(raw_files: &[(String, PathBuf)]) -> Option<String> {
    if raw_files.is_empty() {
        return None;
    }
    let first_seg = raw_files[0].0.split('/').next()?;
    if !raw_files[0].0.contains('/') || is_structural_dir(first_seg) {
        return None;
    }
    if raw_files
        .iter()
        .all(|(rel, _)| rel.split('/').next() == Some(first_seg) && rel.contains('/'))
    {
        // Do not strip if immediate children are `Scripts/main.lua` or `dlls/*.dll` — that folder IS the UE4SS mod folder!
        let is_ue4ss_mod_folder = raw_files.iter().any(|(rel, _)| {
            let sub = &rel[first_seg.len() + 1..].to_ascii_lowercase();
            sub.starts_with("scripts/") || sub.starts_with("dlls/") || sub == "enabled.txt"
        });
        if is_ue4ss_mod_folder {
            return None;
        }
        return Some(first_seg.to_string());
    }
    None
}

type FilePair = (String, String, PathBuf);

fn partition_into_variants(
    raw_files: &[(String, PathBuf)],
    wrapper: Option<&str>,
    fallback_name: &str,
) -> Result<Vec<(String, Vec<FilePair>)>> {
    let trimmed: Vec<FilePair> = raw_files
        .iter()
        .map(|(orig_rel, abs)| {
            let inner = match wrapper {
                Some(w) => orig_rel
                    .strip_prefix(&format!("{w}/"))
                    .unwrap_or(orig_rel)
                    .to_string(),
                None => orig_rel.clone(),
            };
            (orig_rel.clone(), inner, abs.clone())
        })
        .collect();

    // Group by first path segment when there are >= 2 non-structural top-level folders
    // that each contain installable packages (.pak/.utoc/Scripts/main.js), indicating mutually exclusive variants!
    let mut by_top: BTreeMap<String, Vec<FilePair>> = BTreeMap::new();
    let mut has_root_files = false;
    for item in &trimmed {
        if let Some((top, _rest)) = item.1.split_once('/') {
            if is_structural_dir(top) {
                has_root_files = true;
            } else {
                by_top.entry(top.to_string()).or_default().push(item.clone());
            }
        } else {
            has_root_files = true;
        }
    }

    if !has_root_files && by_top.len() >= 2 {
        // Distinguish "2 independent UE4SS mods in one pack" (`ModA/Scripts/main.lua` + `ModB/Scripts/main.lua`)
        // from "Option A / Option B variants" (`OptA/foo_P.pak`, `OptA/ue4ss/Mods/X/Scripts/main.lua`, `OptA/main.js`).
        let all_are_direct_ue4ss_mods = by_top.iter().all(|(k, group)| {
            group.iter().any(|(_, inner, _)| {
                let sub = inner
                    .strip_prefix(&format!("{k}/"))
                    .unwrap_or(inner)
                    .to_ascii_lowercase();
                sub.starts_with("scripts/") || sub.starts_with("dlls/") || sub == "enabled.txt"
            }) && !group.iter().any(|(_, inner, _)| {
                let l = inner.to_ascii_lowercase();
                l.ends_with(".pak") || l.ends_with(".utoc")
            })
        });

        let all_have_paks_or_same_files = if all_are_direct_ue4ss_mods {
            false
        } else {
            let all_have_pak = by_top.values().all(|group| {
                group.iter().any(|(_, inner, _)| {
                    let l = inner.to_ascii_lowercase();
                    l.ends_with(".pak") || l.ends_with(".utoc")
                })
            });
            let mut inner_sets: Vec<BTreeSet<String>> = Vec::new();
            for (k, group) in &by_top {
                let set: BTreeSet<String> = group
                    .iter()
                    .filter_map(|(_, inner, _)| {
                        inner
                            .strip_prefix(&format!("{k}/"))
                            .map(|s| s.to_ascii_lowercase())
                    })
                    .collect();
                inner_sets.push(set);
            }
            let mut overlapping_names = false;
            for i in 0..inner_sets.len() {
                for j in (i + 1)..inner_sets.len() {
                    if inner_sets[i].intersection(&inner_sets[j]).next().is_some() {
                        overlapping_names = true;
                        break;
                    }
                }
                if overlapping_names {
                    break;
                }
            }
            all_have_pak || overlapping_names
        };

        if all_have_paks_or_same_files {
            let mut result = Vec::new();
            for (variant_folder, group) in by_top {
                let unwrapped = group
                    .into_iter()
                    .map(|(orig, inner, abs)| {
                        let sub = inner
                            .strip_prefix(&format!("{variant_folder}/"))
                            .unwrap_or(&inner)
                            .to_string();
                        (orig, sub, abs)
                    })
                    .collect();
                result.push((variant_folder, unwrapped));
            }
            return Ok(result);
        }
    }

    let _ = fallback_name;
    Ok(vec![("default".to_string(), trimmed)])
}

fn build_variant(
    variant_name: &str,
    fallback_mod_name: &str,
    items: &[FilePair],
) -> Result<ScannedVariant> {
    let mut staged_files = Vec::new();
    let mut containers = Vec::new();
    let mut warnings = Vec::new();
    let mut problems = Vec::new();
    let mut categories_set = Vec::new();
    let mut ue4ss_code_mods: BTreeSet<String> = BTreeSet::new();
    let mut ue4ss_all_mods: BTreeSet<String> = BTreeSet::new();
    let mut pbz_loader_mods: BTreeSet<String> = BTreeSet::new();
    let mut pbz_loader_has_js: BTreeSet<String> = BTreeSet::new();
    let mut pbz_loader_has_ts: BTreeSet<String> = BTreeSet::new();
    let mut has_ue4ss_cpp_dll = false;
    let mut iostore_bases: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut shipped_disabled_ue4ss: BTreeSet<String> = BTreeSet::new();

    // Respect `ModName : 0` entries in bundled `mods.txt` (e.g. `SplitScreenMod : 0`, `LineTraceMod : 0` in UE4SS releases)
    for (_orig, inner_rel, abs_path) in items {
        if inner_rel.to_ascii_lowercase().ends_with("mods.txt")
            && let Ok(txt) = fs::read_to_string(abs_path)
        {
            for line in txt.lines() {
                let trimmed = line.trim();
                if !trimmed.starts_with(';')
                    && let Some((lhs, rhs)) = trimmed.split_once(':')
                    && rhs.trim() == "0"
                {
                    shipped_disabled_ue4ss.insert(lhs.trim().to_ascii_lowercase());
                }
            }
        }
    }

    for (orig_rel, inner_rel, abs_path) in items {
        let Some((target, target_rel, uncertain)) =
            classify_single_file(inner_rel, fallback_mod_name, &mut warnings, &mut problems)
        else {
            continue;
        };

        let meta = fs::metadata(abs_path)?;
        let sha256 = sha256_file(abs_path)?;
        let lower_rel = target_rel.to_ascii_lowercase();
        let fname = Path::new(&target_rel)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();

        let is_script_mod_txt_cfg = matches!(
            target,
            DeployTarget::PbzModLoaderMods | DeployTarget::ModsMenuMods
        ) && fname.ends_with(".txt")
            && !matches!(
                fname.as_str(),
                "enabled.txt" | "mods.txt" | "load_order.txt" | "licenses.txt" | "license.txt"
            );

        let is_user_config = fname == "config.lua"
            || fname == "config.json"
            || fname == "settings.json"
            || is_script_mod_txt_cfg
            || (fname.ends_with(".ini") && fname != "mods.ini");

        // Inspect .pak & .utoc headers for asset/chunk conflict indexing
        if matches!(target, DeployTarget::TildeMods | DeployTarget::LogicMods) {
            if fname.ends_with(".pak") || fname.ends_with(".utoc") {
                containers.push(inspect_container(abs_path));
            }
            if fname.ends_with(".pak") || fname.ends_with(".utoc") || fname.ends_with(".ucas") {
                let stem = Path::new(&target_rel)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or_default()
                    .to_string();
                let ext = Path::new(&target_rel)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or_default()
                    .to_ascii_lowercase();
                iostore_bases.entry(stem).or_default().insert(ext);
            }
        }

        if target == DeployTarget::Ue4ssMods
            && let Some((mod_folder, sub)) = target_rel.split_once('/')
            && !mod_folder.eq_ignore_ascii_case("shared")
        {
            // Never copy loose enabled.txt directly; deployer manages enabled.txt deterministically.
            if sub.eq_ignore_ascii_case("enabled.txt") {
                continue;
            }
            ue4ss_all_mods.insert(mod_folder.to_string());
            let is_disabled_by_default =
                shipped_disabled_ue4ss.contains(&mod_folder.to_ascii_lowercase());
            let sub_low = sub.to_ascii_lowercase();
            if sub_low.starts_with("scripts/") && sub_low.ends_with(".lua") && !is_disabled_by_default {
                ue4ss_code_mods.insert(mod_folder.to_string());
            }
            if sub_low.starts_with("dlls/") && sub_low.ends_with(".dll") {
                if !is_disabled_by_default {
                    ue4ss_code_mods.insert(mod_folder.to_string());
                }
                has_ue4ss_cpp_dll = true;
            }
        }

        if target == DeployTarget::PbzModLoaderMods
            && let Some((mod_folder, sub)) = target_rel.split_once('/')
        {
            pbz_loader_mods.insert(mod_folder.to_string());
            if sub.eq_ignore_ascii_case("main.js") || lower_rel.ends_with(".js") {
                pbz_loader_has_js.insert(mod_folder.to_string());
            }
            if sub.eq_ignore_ascii_case("main.ts") || lower_rel.ends_with(".ts") {
                pbz_loader_has_ts.insert(mod_folder.to_string());
            }
        }

        // Deduplicate identical `(target, target_rel)` entries within the same variant
        // (e.g. PBZModLoader shipping identical `platform/steam/version.dll` and `platform/wegame/version.dll`)
        if staged_files
            .iter()
            .any(|existing: &StagedFileEntry| {
                existing.target == target && existing.target_rel.eq_ignore_ascii_case(&target_rel)
            })
        {
            continue;
        }

        staged_files.push(StagedFileEntry {
            source_rel: orig_rel.clone(),
            target,
            target_rel,
            size_bytes: meta.len(),
            sha256,
            is_user_config,
            uncertain,
        });
    }

    // Validate IoStore .utoc/.ucas pairing integrity
    for (stem, exts) in &iostore_bases {
        if exts.contains("utoc") && !exts.contains("ucas") {
            problems.push(format!("IoStore 容器不完整：`{stem}.utoc` 缺少对应的 `{stem}.ucas` 文件"));
        }
        if exts.contains("ucas") && !exts.contains("utoc") {
            problems.push(format!("IoStore 容器不完整：`{stem}.ucas` 缺少对应的 `{stem}.utoc` 文件"));
        }
        if (exts.contains("utoc") || exts.contains("ucas")) && !exts.contains("pak") {
            warnings.push(format!(
                "IoStore 容器 `{stem}` 未包含配套 `.pak` 文件，UE5 游戏通常需要同名 `.pak` 才能挂载"
            ));
        }
    }

    // Warn if PBZModLoader mod has only main.ts and no main.js (PBZModLoader 2.0 dropped TS compiler)
    for m in &pbz_loader_mods {
        if pbz_loader_has_ts.contains(m) && !pbz_loader_has_js.contains(m) {
            warnings.push(format!(
                "PBZModLoader 模组 `{m}` 仅包含 `.ts` 源码而无 `.js` 文件，新版 PBZModLoader 2.0 已移除内置编译器，可能无法运行"
            ));
        }
    }

    if has_ue4ss_cpp_dll {
        warnings.push(
            "包含 UE4SS 原生 C++ DLL 插件：该类插件与特定 UE4SS 版本强绑定，后续升级 UE4SS 前请注意兼容风险".to_string(),
        );
    }

    // Compute categories summary
    if staged_files.iter().any(|f| f.target == DeployTarget::TildeMods) {
        let any_iostore = iostore_bases
            .values()
            .any(|e| e.contains("utoc") || e.contains("ucas"));
        categories_set.push(if any_iostore {
            ModCategory::IoStore
        } else {
            ModCategory::Pak
        });
    }
    if staged_files.iter().any(|f| f.target == DeployTarget::LogicMods) {
        categories_set.push(ModCategory::BlueprintLogic);
    }
    if !ue4ss_all_mods.is_empty() {
        let has_lua = staged_files.iter().any(|f| {
            f.target == DeployTarget::Ue4ssMods
                && f.target_rel.to_ascii_lowercase().contains("/scripts/")
        });
        match (has_lua, has_ue4ss_cpp_dll) {
            (true, true) => categories_set.push(ModCategory::Ue4ssLuaAndDll),
            (true, false) => categories_set.push(ModCategory::Ue4ssLua),
            (false, true) => categories_set.push(ModCategory::Ue4ssDll),
            (false, false) => categories_set.push(ModCategory::Ue4ssDataFolder),
        }
    }
    if staged_files
        .iter()
        .any(|f| f.target == DeployTarget::PbzModLoaderMods)
    {
        categories_set.push(ModCategory::PbzModLoaderScript);
    }
    if staged_files
        .iter()
        .any(|f| f.target == DeployTarget::ModsMenuMods)
    {
        categories_set.push(ModCategory::ModsMenuScript);
    }
    if staged_files.iter().any(|f| f.target == DeployTarget::ExeFolder) {
        categories_set.push(ModCategory::ExeProxy);
    }
    if staged_files.iter().any(|f| f.target == DeployTarget::GameRoot) {
        categories_set.push(ModCategory::GameFiles);
    }
    if categories_set.len() > 1 {
        categories_set.push(ModCategory::Hybrid);
    }

    Ok(ScannedVariant {
        name: variant_name.to_string(),
        categories: categories_set,
        files: staged_files,
        containers,
        writes_ue4ss_enabled_txt: ue4ss_code_mods.into_iter().collect(),
        ue4ss_mod_names: ue4ss_all_mods.into_iter().collect(),
        pbz_loader_mod_names: pbz_loader_mods.into_iter().collect(),
        has_ue4ss_cpp_dll,
        warnings,
        problems,
    })
}

fn classify_single_file(
    rel: &str,
    fallback_mod_name: &str,
    warnings: &mut Vec<String>,
    problems: &mut Vec<String>,
) -> Option<(DeployTarget, String, bool)> {
    let mut parts: Vec<&str> = rel.split('/').filter(|s| !s.is_empty()).collect();
    if parts.is_empty() {
        return None;
    }
    // Strip outer `PBZ/` game-root folder if author zipped the whole root folder
    if parts.len() > 1 && parts[0].eq_ignore_ascii_case("PBZ") {
        parts.remove(0);
    }
    let joined = parts.join("/");
    let lower_parts: Vec<String> = parts.iter().map(|s| s.to_ascii_lowercase()).collect();

    // Never allow a mod package to overwrite player SaveGames!
    if lower_parts
        .windows(2)
        .any(|w| w[0] == "saved" && w[1] == "savegames")
    {
        problems.push(format!(
            "已拦截试图写入玩家存档目录的文件 `{joined}`（请使用存档恢复专用命令）"
        ));
        return None;
    }

    // Ignore loose `mods.txt` or `mods.ini` shipped inside mod zips so they never clobber user load lists!
    let fname = lower_parts.last()?.as_str();
    if fname == "mods.txt" || fname == "mods.ini" {
        warnings.push(format!(
            "已忽略压缩包内自带的全局列表文件 `{joined}`，由管理器安全维护开关状态"
        ));
        return None;
    }

    // Ignore optional manual fallback DLL folders shipped in loader archives (`alternative-entries/...`)
    if lower_parts.first().is_some_and(|p| p == "alternative-entries") {
        return None;
    }

    // 1. Explicit `platform/<any_store>/...` (rewrites hardcoded `steam`/`wegame`/`epic` transparently!)
    if let Some(plat_idx) = lower_parts.iter().position(|p| p == "platform")
        && plat_idx + 2 < parts.len()
    {
        let after_store = &parts[plat_idx + 2..];
        let after_lower = &lower_parts[plat_idx + 2..];
        if after_lower.len() >= 3 && after_lower[0] == "ue4ss" && after_lower[1] == "mods" {
            return Some((DeployTarget::Ue4ssMods, after_store[2..].join("/"), false));
        }
        let sub_rel = after_store.join("/");
        let uncertain = is_uncertain_exe_file(&sub_rel);
        return Some((DeployTarget::ExeFolder, sub_rel, uncertain));
    }

    // 2. Explicit `ue4ss/...` (both `ue4ss/Mods/<ModName>/...` and core UE4SS runtime files like `ue4ss/UE4SS.dll`, `ue4ss/UE4SS-settings.ini`, `ue4ss/UE4SS_Signatures/*`)
    if let Some(u_idx) = lower_parts.iter().position(|p| p == "ue4ss")
        && u_idx + 1 < parts.len()
    {
        if u_idx + 2 < parts.len() && lower_parts[u_idx + 1] == "mods" {
            return Some((
                DeployTarget::Ue4ssMods,
                parts[u_idx + 2..].join("/"),
                false,
            ));
        }
        return Some((
            DeployTarget::ExeFolder,
            format!("ue4ss/{}", parts[u_idx + 1..].join("/")),
            false,
        ));
    }

    // 3. Explicit `ProjectPBZ/...` paths
    if let Some(proj_idx) = lower_parts.iter().position(|p| p == "projectpbz") {
        let sub = &parts[proj_idx + 1..];
        let sub_low = &lower_parts[proj_idx + 1..];

        // ProjectPBZ/PBZModLoader/mods/<Name>/...
        if sub_low.len() >= 3 && sub_low[0] == "pbzmodloader" && sub_low[1] == "mods" {
            return Some((DeployTarget::PbzModLoaderMods, sub[2..].join("/"), false));
        }
        // ProjectPBZ/Content/JavaScript/PBZModsMenu/Mods/<Name>/...
        if sub_low.len() >= 5
            && sub_low[0] == "content"
            && sub_low[1] == "javascript"
            && sub_low[2] == "pbzmodsmenu"
            && sub_low[3] == "mods"
        {
            return Some((DeployTarget::ModsMenuMods, sub[4..].join("/"), false));
        }
        // ProjectPBZ/Content/Paks/LogicMods/...
        if sub_low.len() >= 4
            && sub_low[0] == "content"
            && sub_low[1] == "paks"
            && sub_low[2] == "logicmods"
        {
            return Some((DeployTarget::LogicMods, sub[3..].join("/"), false));
        }
        // ProjectPBZ/Content/Paks/~mods/... or ProjectPBZ/Content/Paks/*.pak
        if sub_low.len() >= 3 && sub_low[0] == "content" && sub_low[1] == "paks" {
            if sub_low[2] == "~mods" && sub.len() >= 4 {
                return Some((DeployTarget::TildeMods, sub[3..].join("/"), false));
            }
            return Some((DeployTarget::TildeMods, sub[2..].join("/"), false));
        }

        // Other legitimate files placed under ProjectPBZ/ (e.g. ModsMenu framework itself or EnhancedInputUserSettings.sav)
        return Some((
            DeployTarget::GameRoot,
            format!("ProjectPBZ/{}", sub.join("/")),
            false,
        ));
    }

    // 4. Shorthand `PBZModLoader/mods/<Name>/...` or `PBZModsMenu/Mods/<Name>/...`
    if lower_parts.len() >= 3 && lower_parts[0] == "pbzmodloader" && lower_parts[1] == "mods" {
        return Some((DeployTarget::PbzModLoaderMods, parts[2..].join("/"), false));
    }
    if let Some(mm_idx) = lower_parts.iter().position(|p| p == "pbzmodsmenu")
        && mm_idx + 2 < parts.len()
        && lower_parts[mm_idx + 1] == "mods"
    {
        return Some((
            DeployTarget::ModsMenuMods,
            parts[mm_idx + 2..].join("/"),
            false,
        ));
    }

    // 5. Shorthand `LogicMods/...` or `~mods/...`
    if let Some(lm_idx) = lower_parts.iter().position(|p| p == "logicmods")
        && lm_idx + 1 < parts.len()
    {
        return Some((DeployTarget::LogicMods, parts[lm_idx + 1..].join("/"), false));
    }
    if let Some(tm_idx) = lower_parts.iter().position(|p| p == "~mods")
        && tm_idx + 1 < parts.len()
    {
        return Some((DeployTarget::TildeMods, parts[tm_idx + 1..].join("/"), false));
    }

    // 6. Bare UE4SS mod layouts: `<ModFolder>/Scripts/main.lua` or `Scripts/main.lua` or `dlls/main.dll`
    if lower_parts[0] == "scripts" || lower_parts[0] == "dlls" {
        return Some((
            DeployTarget::Ue4ssMods,
            format!("{fallback_mod_name}/{joined}"),
            false,
        ));
    }
    if lower_parts.len() >= 3
        && (lower_parts[1] == "scripts" || lower_parts[1] == "dlls")
    {
        return Some((DeployTarget::Ue4ssMods, joined, false));
    }
    if lower_parts.len() >= 3
        && lower_parts[0] == "mods"
        && (lower_parts[2] == "scripts" || lower_parts[2] == "dlls")
    {
        return Some((DeployTarget::Ue4ssMods, parts[1..].join("/"), false));
    }

    // 7. Bare PBZModLoader mod layout: `main.js` / `main.ts` / `mod.json`
    if fname == "main.js" || fname == "main.ts" || fname == "mod.json" {
        if parts.len() == 1 {
            return Some((
                DeployTarget::PbzModLoaderMods,
                format!("{fallback_mod_name}/{joined}"),
                false,
            ));
        } else if parts.len() == 2 {
            return Some((DeployTarget::PbzModLoaderMods, joined, false));
        }
    }

    // 8. Bare `.pak` / `.utoc` / `.ucas` / `.sig` containers
    if fname.ends_with(".pak")
        || fname.ends_with(".utoc")
        || fname.ends_with(".ucas")
        || fname.ends_with(".sig")
    {
        let file_only = parts.last().unwrap().to_string();
        return Some((DeployTarget::TildeMods, file_only, false));
    }

    // 9. Root `hid.dll` when shipped alongside `ProjectPBZ/...` belongs to Mods Menu (#149) root loader;
    // standalone proxy DLLs / .asi / ReShade go next to shipping PBZ.exe in `platform/<store>/`.
    if KNOWN_PROXY_DLLS.contains(&fname)
        || fname.ends_with(".asi")
        || fname.ends_with(".addon")
        || fname.ends_with(".addon64")
        || lower_parts[0] == "reshade-shaders"
    {
        return Some((DeployTarget::ExeFolder, joined, false));
    }

    if fname.ends_with(".dll") {
        // Unknown DLL without explicit folder -> mark uncertain so user/Agent must confirm!
        return Some((DeployTarget::ExeFolder, joined, true));
    }

    None
}

fn is_uncertain_exe_file(rel: &str) -> bool {
    let lower = rel.to_ascii_lowercase();
    if !lower.ends_with(".dll") {
        return false;
    }
    if lower.contains('/') {
        return false;
    }
    !KNOWN_PROXY_DLLS.contains(&lower.as_str())
}
