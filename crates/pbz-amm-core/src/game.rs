// Copyright 2026 PBZ-AMM Contributors
// SPDX-License-Identifier: Apache-2.0

use crate::error::{AmmError, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use winreg::RegKey;
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

/// Verified Steam AppID for Phantom Blade Zero.
pub const PBZ_STEAM_APP_ID: &str = "4115450";
/// Verified Nexus Mods numeric Game ID and domain slug.
pub const PBZ_NEXUS_GAME_ID: u32 = 10614;
pub const PBZ_NEXUS_DOMAIN: &str = "phantombladezero";
/// Unreal Engine project directory name.
pub const PBZ_PROJECT_NAME: &str = "ProjectPBZ";
/// Minimum real shipping executable size in production discovery (50 MiB).
pub const MIN_SHIPPING_EXE_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StorePlatform {
    Steam,
    WeGame,
    Epic,
    Custom(String),
}

impl StorePlatform {
    pub fn folder_name(&self) -> &str {
        match self {
            Self::Steam => "steam",
            Self::WeGame => "wegame",
            Self::Epic => "epic",
            Self::Custom(s) => s.as_str(),
        }
    }
}

/// Detected core modding frameworks currently installed in the game directory.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct InstalledFrameworks {
    pub ue4ss: bool,
    pub mods_menu: bool,
    pub pbz_mod_loader: bool,
    pub cpp_pak_bypass: bool,
    pub outfit_framework: bool,
    pub occupied_proxy_dlls: Vec<String>,
}

/// Resolved & validated directory layout for a Phantom Blade Zero installation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameInstall {
    pub root_dir: PathBuf,
    pub store: StorePlatform,
    pub exe_dir: PathBuf,
    pub shipping_exe: PathBuf,
    pub project_dir: PathBuf,
    pub paks_dir: PathBuf,
    pub tilde_mods_dir: PathBuf,
    pub logic_mods_dir: PathBuf,
    pub ue4ss_mods_dir: PathBuf,
    pub pbz_mod_loader_dir: PathBuf,
    pub pbz_mod_loader_mods_dir: PathBuf,
    pub mods_menu_mods_dir: PathBuf,
    pub save_games_dir: PathBuf,
}

impl GameInstall {
    /// Validate a candidate game root directory.
    /// Set `allow_small_exe_for_tests` to `true` only in synthetic unit-test sandboxes.
    pub fn from_root(root: impl AsRef<Path>, allow_small_exe_for_tests: bool) -> Result<Self> {
        let root_dir = root.as_ref().to_path_buf();
        if !root_dir.is_dir() {
            return Err(AmmError::GameNotFound(format!(
                "目录不存在: {}",
                root_dir.display()
            )));
        }

        let project_dir = resolve_project_dir(&root_dir)?;
        let min_bytes = if allow_small_exe_for_tests {
            1
        } else {
            MIN_SHIPPING_EXE_BYTES
        };
        let (store, exe_dir, shipping_exe) = resolve_platform_exe(&root_dir, min_bytes)?;

        let paks_dir = project_dir.join("Content").join("Paks");
        let tilde_mods_dir = paks_dir.join("~mods");
        let logic_mods_dir = paks_dir.join("LogicMods");
        let ue4ss_mods_dir = exe_dir.join("ue4ss").join("Mods");
        let pbz_mod_loader_dir = project_dir.join("PBZModLoader");
        let pbz_mod_loader_mods_dir = pbz_mod_loader_dir.join("mods");
        let mods_menu_mods_dir = project_dir
            .join("Content")
            .join("JavaScript")
            .join("PBZModsMenu")
            .join("Mods");
        let save_games_dir = project_dir.join("Saved").join("SaveGames");

        Ok(Self {
            root_dir,
            store,
            exe_dir,
            shipping_exe,
            project_dir,
            paks_dir,
            tilde_mods_dir,
            logic_mods_dir,
            ue4ss_mods_dir,
            pbz_mod_loader_dir,
            pbz_mod_loader_mods_dir,
            mods_menu_mods_dir,
            save_games_dir,
        })
    }

    /// Auto-discover Phantom Blade Zero via Steam VDF manifests or Epic Games manifests.
    pub fn auto_discover() -> Result<Self> {
        if let Some(root) = find_via_steam()
            && let Ok(install) = Self::from_root(&root, false)
        {
            return Ok(install);
        }
        if let Some(root) = find_via_epic()
            && let Ok(install) = Self::from_root(&root, false)
        {
            return Ok(install);
        }
        Err(AmmError::GameNotFound(
            "未能从 Steam 或 Epic 注册表自动定位游戏安装路径".to_string(),
        ))
    }

    /// Inspect which prerequisite loaders and proxy DLLs are currently present.
    pub fn detect_frameworks(&self) -> InstalledFrameworks {
        let ue4ss =
            self.exe_dir.join("ue4ss").is_dir() && self.exe_dir.join("dwmapi.dll").is_file();
        let mods_menu = self.root_dir.join("hid.dll").is_file()
            || self
                .project_dir
                .join("Content")
                .join("JavaScript")
                .join("PBZModsMenu")
                .is_dir();
        let pbz_mod_loader = self.pbz_mod_loader_dir.is_dir();

        let cpp_pak_bypass = self.ue4ss_mods_dir.is_dir()
            && fs::read_dir(&self.ue4ss_mods_dir)
                .ok()
                .into_iter()
                .flatten()
                .flatten()
                .any(|e| {
                    let n = e.file_name().to_string_lossy().to_ascii_lowercase();
                    n.contains("cppbypass") || n.contains("pakbypass")
                });

        let outfit_framework = self.tilde_mods_dir.is_dir()
            && fs::read_dir(&self.tilde_mods_dir)
                .ok()
                .into_iter()
                .flatten()
                .flatten()
                .any(|e| {
                    e.file_name()
                        .to_string_lossy()
                        .to_ascii_lowercase()
                        .contains("outfitframework")
                });

        let known_proxies = [
            "dwmapi.dll",
            "version.dll",
            "hid.dll",
            "dxgi.dll",
            "dsound.dll",
            "winmm.dll",
            "winhttp.dll",
            "dinput8.dll",
            "xinput1_3.dll",
        ];
        let mut occupied_proxy_dlls = Vec::new();
        for dll in known_proxies {
            if self.exe_dir.join(dll).is_file() {
                occupied_proxy_dlls.push(format!("platform/{}/{dll}", self.store.folder_name()));
            }
            if self.root_dir.join(dll).is_file() {
                occupied_proxy_dlls.push(dll.to_string());
            }
        }

        InstalledFrameworks {
            ue4ss,
            mods_menu,
            pbz_mod_loader,
            cpp_pak_bypass,
            outfit_framework,
            occupied_proxy_dlls,
        }
    }

    /// Guard that checks whether the game's shipping executable is currently running.
    pub fn ensure_game_closed(&self) -> Result<()> {
        let exe_name = self
            .shipping_exe
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("PBZ.exe");

        // Query Windows tasklist filtered by image name for fast, zero-privilege detection.
        let output = Command::new("tasklist")
            .args(["/FI", &format!("IMAGENAME eq {exe_name}"), "/FO", "CSV", "/NH"])
            .output();

        if let Ok(out) = output {
            let stdout = String::from_utf8_lossy(&out.stdout);
            for line in stdout.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with('"')
                    && trimmed
                        .to_ascii_lowercase()
                        .contains(&exe_name.to_ascii_lowercase())
                {
                    return Err(AmmError::GameRunning(exe_name.to_string()));
                }
            }
        }
        Ok(())
    }
}

fn resolve_project_dir(root_dir: &Path) -> Result<PathBuf> {
    let preferred = root_dir.join(PBZ_PROJECT_NAME);
    if preferred.join("Content").join("Paks").is_dir() {
        return Ok(preferred);
    }
    // Fallback: scan immediate children for any Unreal project folder holding Content/Paks.
    if let Ok(entries) = fs::read_dir(root_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && path.join("Content").join("Paks").is_dir() {
                return Ok(path);
            }
        }
    }
    Err(AmmError::GameNotFound(format!(
        "{} 下未找到 {}/Content/Paks 结构",
        root_dir.display(),
        PBZ_PROJECT_NAME
    )))
}

fn resolve_platform_exe(
    root_dir: &Path,
    min_exe_bytes: u64,
) -> Result<(StorePlatform, PathBuf, PathBuf)> {
    let platform_dir = root_dir.join("platform");
    if !platform_dir.is_dir() {
        return Err(AmmError::GameNotFound(format!(
            "{} 下未找到 platform/<store> 目录（请注意不要误选内层子目录）",
            root_dir.display()
        )));
    }

    let priority = ["steam", "wegame", "epic"];
    let mut subdirs: Vec<PathBuf> = Vec::new();
    for name in priority {
        let candidate = platform_dir.join(name);
        if candidate.is_dir() {
            subdirs.push(candidate);
        }
    }
    if let Ok(entries) = fs::read_dir(&platform_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() && !subdirs.contains(&p) {
                subdirs.push(p);
            }
        }
    }

    for dir in subdirs {
        let store_slug = dir
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("steam")
            .to_ascii_lowercase();
        let store = match store_slug.as_str() {
            "steam" => StorePlatform::Steam,
            "wegame" => StorePlatform::WeGame,
            "epic" => StorePlatform::Epic,
            other => StorePlatform::Custom(other.to_string()),
        };

        let pbz_exe = dir.join("PBZ.exe");
        if let Ok(meta) = fs::metadata(&pbz_exe)
            && meta.is_file()
            && meta.len() >= min_exe_bytes
        {
            return Ok((store, dir, pbz_exe));
        }

        // Store build fallback: pick largest .exe >= min_exe_bytes in platform/<store>/
        if let Ok(files) = fs::read_dir(&dir) {
            let mut best: Option<(u64, PathBuf)> = None;
            for f in files.flatten() {
                let fp = f.path();
                if fp
                    .extension()
                    .and_then(|e| e.to_str())
                    .is_some_and(|e| e.eq_ignore_ascii_case("exe"))
                    && let Ok(meta) = f.metadata()
                    && meta.len() >= min_exe_bytes
                    && best.as_ref().is_none_or(|(b, _)| meta.len() > *b)
                {
                    best = Some((meta.len(), fp));
                }
            }
            if let Some((_, best_exe)) = best {
                return Ok((store, dir, best_exe));
            }
        }
    }

    Err(AmmError::GameNotFound(format!(
        "在 {}\\platform\\* 下未找到有效的主程序 PBZ.exe",
        root_dir.display()
    )))
}

fn find_via_steam() -> Option<PathBuf> {
    let steam_root = read_steam_path()?;
    let vdf_path = steam_root.join("steamapps").join("libraryfolders.vdf");
    let mut libraries = vec![steam_root];

    if let Ok(content) = fs::read_to_string(&vdf_path) {
        for line in content.lines() {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("\"path\"") {
                let val = rest.trim().trim_matches('"').replace("\\\\", "\\");
                if !val.is_empty() {
                    libraries.push(PathBuf::from(val));
                }
            }
        }
    }

    for lib in libraries {
        let acf = lib
            .join("steamapps")
            .join(format!("appmanifest_{PBZ_STEAM_APP_ID}.acf"));
        if let Ok(acf_text) = fs::read_to_string(&acf) {
            for line in acf_text.lines() {
                let trimmed = line.trim();
                if let Some(rest) = trimmed.strip_prefix("\"installdir\"") {
                    let install_dir = rest.trim().trim_matches('"');
                    let candidate = lib.join("steamapps").join("common").join(install_dir);
                    if candidate.is_dir() {
                        return Some(candidate);
                    }
                }
            }
        }
    }
    None
}

fn read_steam_path() -> Option<PathBuf> {
    if let Ok(hkcu) = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Software\\Valve\\Steam")
        && let Ok(p) = hkcu.get_value::<String, _>("SteamPath")
    {
        return Some(PathBuf::from(p));
    }
    if let Ok(hklm) =
        RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey("SOFTWARE\\WOW6432Node\\Valve\\Steam")
        && let Ok(p) = hklm.get_value::<String, _>("InstallPath")
    {
        return Some(PathBuf::from(p));
    }
    None
}

fn find_via_epic() -> Option<PathBuf> {
    let manifests = PathBuf::from(r"C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests");
    let entries = fs::read_dir(manifests).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("item")
            && let Ok(raw) = fs::read_to_string(&path)
            && let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw)
            && json
                .get("DisplayName")
                .and_then(|v| v.as_str())
                .is_some_and(|n| n.eq_ignore_ascii_case("Phantom Blade Zero"))
            && let Some(loc) = json.get("InstallLocation").and_then(|v| v.as_str())
        {
            let p = PathBuf::from(loc);
            if p.is_dir() {
                return Some(p);
            }
        }
    }
    None
}
