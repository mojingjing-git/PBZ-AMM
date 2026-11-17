// Copyright 2026 PBZ-AMM Contributors
// SPDX-License-Identifier: Apache-2.0

#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use pbz_amm_core::deployer::{InstallOptions, ModManager};
use pbz_amm_core::error::{AmmError, ResponseStatus};
use pbz_amm_core::nexus::{self, NxmUri};
use pbz_amm_core::telemetry::{
    AgentActivityEvent, activity_log_path, read_recent_activity, resolve_default_data_dir,
    resolve_sibling_cli_exe,
};
use serde::Serialize;
use serde_json::{Value, json};
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::webview::DownloadEvent;
use tauri::{Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder};

struct NexusBrowserState {
    pending_meta: Mutex<Option<(u32, String)>>,
}

#[derive(Serialize)]
struct UiEnvelope {
    status: ResponseStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    selection: Option<pbz_amm_core::error::SelectionPrompt>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl UiEnvelope {
    fn from_result<T: Serialize>(res: Result<T, AmmError>) -> Self {
        match res {
            Ok(val) => Self {
                status: ResponseStatus::Ok,
                data: serde_json::to_value(val).ok(),
                selection: None,
                error: None,
            },
            Err(AmmError::NeedsSelection(prompt)) => {
                let msg = prompt.reason.clone();
                Self {
                    status: ResponseStatus::NeedsSelection,
                    data: None,
                    selection: Some(*prompt),
                    error: Some(msg),
                }
            }
            Err(err) => Self {
                status: err.status(),
                data: None,
                selection: None,
                error: Some(err.to_string()),
            },
        }
    }
}

fn shared_data_dir() -> PathBuf {
    resolve_default_data_dir()
}

fn sibling_cli_exe() -> PathBuf {
    resolve_sibling_cli_exe()
}

#[tauri::command]
async fn cmd_get_recent_activity() -> UiEnvelope {
    tauri::async_runtime::spawn_blocking(|| {
        let data_dir = shared_data_dir();
        let events = read_recent_activity(&data_dir, 40);
        UiEnvelope::from_result::<Vec<AgentActivityEvent>>(Ok(events))
    })
    .await
    .unwrap_or_else(|e| UiEnvelope::from_result::<Value>(Err(AmmError::Other(e.to_string()))))
}

#[tauri::command]
async fn cmd_get_dashboard() -> UiEnvelope {
    tauri::async_runtime::spawn_blocking(|| {
        let data_dir = shared_data_dir();
        let cli_exe = sibling_cli_exe();
        let res = (|| -> Result<Value, AmmError> {
            let mut mgr = ModManager::open(&data_dir)?;
            let game_res = mgr.resolve_game(None);
            let (game_val, fw_val, unmanaged_val, game_hint_err) = match game_res {
                Ok(g) => {
                    let fw = g.detect_frameworks();
                    let un = mgr.scan_unmanaged_mods(&g).unwrap_or_default();
                    (
                        serde_json::to_value(&g).ok(),
                        serde_json::to_value(&fw).ok(),
                        serde_json::to_value(&un).ok(),
                        None,
                    )
                }
                Err(e) => (None, None, Some(json!([])), Some(e.to_string())),
            };

            let conflicts = mgr.check_active_conflicts();
            let has_nexus_key = nexus::load_api_key().is_ok();
            let nxm_registered = nexus::is_nxm_protocol_registered();

            Ok(json!({
                "data_dir": data_dir,
                "cli_exe": cli_exe,
                "game": game_val,
                "game_missing_reason": game_hint_err,
                "frameworks": fw_val,
                "active_profile_id": mgr.state.active_profile_id,
                "profiles": mgr.state.profiles,
                "mods": mgr.state.mods,
                "unmanaged": unmanaged_val,
                "conflicts": conflicts,
                "conflict_messages": conflicts.to_messages(),
                "save_backups": mgr.state.save_backups,
                "has_nexus_key": has_nexus_key,
                "nxm_registered": nxm_registered,
            }))
        })();
        UiEnvelope::from_result(res)
    })
    .await
    .unwrap_or_else(|e| UiEnvelope::from_result::<Value>(Err(AmmError::Other(e.to_string()))))
}

#[tauri::command]
async fn cmd_pick_game_dir() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("选择《影之刃零》游戏安装根目录（包含 ProjectPBZ 与 platform 文件夹）")
            .pick_folder()
            .map(|p| p.display().to_string())
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
async fn cmd_pick_mod_file() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("选择《影之刃零》Mod 压缩包或 .pak 文件")
            .add_filter("Mod Packages", &["zip", "7z", "rar", "pak"])
            .pick_file()
            .map(|p| p.display().to_string())
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
async fn cmd_pick_mod_folder() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("选择解压后的 Mod 文件夹")
            .pick_folder()
            .map(|p| p.display().to_string())
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
async fn cmd_bind_game_dir(path: String) -> UiEnvelope {
    tauri::async_runtime::spawn_blocking(move || {
        let data_dir = shared_data_dir();
        let res = (|| -> Result<Value, AmmError> {
            let mut mgr = ModManager::open(&data_dir)?;
            let game = mgr.resolve_game(Some(&PathBuf::from(path)))?;
            Ok(json!({ "game": game }))
        })();
        UiEnvelope::from_result(res)
    })
    .await
    .unwrap_or_else(|e| UiEnvelope::from_result::<Value>(Err(AmmError::Other(e.to_string()))))
}

#[tauri::command]
async fn cmd_adopt_mods(ids: Vec<String>) -> UiEnvelope {
    tauri::async_runtime::spawn_blocking(move || {
        let data_dir = shared_data_dir();
        let res = (|| -> Result<Value, AmmError> {
            let mut mgr = ModManager::open(&data_dir)?;
            let game = mgr.resolve_game(None)?;
            let adopted = mgr.adopt_unmanaged_mods(&game, &ids)?;
            Ok(json!({ "adopted": adopted }))
        })();
        UiEnvelope::from_result(res)
    })
    .await
    .unwrap_or_else(|e| UiEnvelope::from_result::<Value>(Err(AmmError::Other(e.to_string()))))
}

#[tauri::command]
async fn cmd_inspect_source(path: String) -> UiEnvelope {
    tauri::async_runtime::spawn_blocking(move || {
        let data_dir = shared_data_dir();
        let res = (|| -> Result<Value, AmmError> {
            let mut mgr = ModManager::open(&data_dir)?;
            let game = mgr.resolve_game(None).ok();
            let p = PathBuf::from(&path);
            let (report, conflicts) = mgr.inspect_source(&p, game.as_ref())?;
            let mut conflict_texts = serde_json::Map::new();
            for (k, v) in &conflicts {
                conflict_texts.insert(k.clone(), json!(v.to_messages()));
            }
            Ok(json!({
                "source_path": path,
                "report": report,
                "conflicts": conflicts,
                "conflict_texts": conflict_texts,
            }))
        })();
        UiEnvelope::from_result(res)
    })
    .await
    .unwrap_or_else(|e| UiEnvelope::from_result::<Value>(Err(AmmError::Other(e.to_string()))))
}

#[tauri::command]
async fn cmd_install_mod(
    path: String,
    select_variant: Option<String>,
    allow_conflicts: bool,
    allow_uncertain: bool,
    nexus_id: Option<u32>,
    version: Option<String>,
) -> UiEnvelope {
    tauri::async_runtime::spawn_blocking(move || {
        let data_dir = shared_data_dir();
        let res = (|| -> Result<Value, AmmError> {
            let mut mgr = ModManager::open(&data_dir)?;
            let game = mgr.resolve_game(None)?;
            let installed = mgr.install_source(
                &game,
                &PathBuf::from(path),
                &InstallOptions {
                    mod_id_override: None,
                    name_override: None,
                    nexus_mod_id: nexus_id,
                    version_override: version,
                    select_variant,
                    allow_conflicts,
                    allow_uncertain_files: allow_uncertain,
                },
            )?;
            Ok(json!({ "installed": installed }))
        })();
        UiEnvelope::from_result(res)
    })
    .await
    .unwrap_or_else(|e| UiEnvelope::from_result::<Value>(Err(AmmError::Other(e.to_string()))))
}

#[tauri::command]
async fn cmd_set_mod_enabled(mod_id: String, enabled: bool) -> UiEnvelope {
    tauri::async_runtime::spawn_blocking(move || {
        let data_dir = shared_data_dir();
        let res = (|| -> Result<Value, AmmError> {
            let mut mgr = ModManager::open(&data_dir)?;
            let game = mgr.resolve_game(None)?;
            mgr.set_mod_enabled(&game, &mod_id, enabled)?;
            Ok(json!({ "mod_id": mod_id, "enabled": enabled }))
        })();
        UiEnvelope::from_result(res)
    })
    .await
    .unwrap_or_else(|e| UiEnvelope::from_result::<Value>(Err(AmmError::Other(e.to_string()))))
}

#[tauri::command]
async fn cmd_rollback_mod(mod_id: String) -> UiEnvelope {
    tauri::async_runtime::spawn_blocking(move || {
        let data_dir = shared_data_dir();
        let res = (|| -> Result<Value, AmmError> {
            let mut mgr = ModManager::open(&data_dir)?;
            let game = mgr.resolve_game(None)?;
            let rolled = mgr.rollback_mod(&game, &mod_id)?;
            Ok(json!({ "mod": rolled }))
        })();
        UiEnvelope::from_result(res)
    })
    .await
    .unwrap_or_else(|e| UiEnvelope::from_result::<Value>(Err(AmmError::Other(e.to_string()))))
}

#[tauri::command]
async fn cmd_remove_mod(mod_id: String) -> UiEnvelope {
    tauri::async_runtime::spawn_blocking(move || {
        let data_dir = shared_data_dir();
        let res = (|| -> Result<Value, AmmError> {
            let mut mgr = ModManager::open(&data_dir)?;
            let game = mgr.resolve_game(None)?;
            mgr.uninstall_mod(&game, &mod_id)?;
            Ok(json!({ "removed": mod_id }))
        })();
        UiEnvelope::from_result(res)
    })
    .await
    .unwrap_or_else(|e| UiEnvelope::from_result::<Value>(Err(AmmError::Other(e.to_string()))))
}

#[tauri::command]
async fn cmd_create_profile(
    id: String,
    name: String,
    desc: String,
    clone_active: bool,
) -> UiEnvelope {
    tauri::async_runtime::spawn_blocking(move || {
        let data_dir = shared_data_dir();
        let res = (|| -> Result<Value, AmmError> {
            let mut mgr = ModManager::open(&data_dir)?;
            let p = mgr.create_profile(&id, &name, &desc, clone_active)?;
            Ok(json!({ "profile": p }))
        })();
        UiEnvelope::from_result(res)
    })
    .await
    .unwrap_or_else(|e| UiEnvelope::from_result::<Value>(Err(AmmError::Other(e.to_string()))))
}

#[tauri::command]
async fn cmd_switch_profile(id: String) -> UiEnvelope {
    tauri::async_runtime::spawn_blocking(move || {
        let data_dir = shared_data_dir();
        let res = (|| -> Result<Value, AmmError> {
            let mut mgr = ModManager::open(&data_dir)?;
            let game = mgr.resolve_game(None)?;
            let p = mgr.switch_profile(&game, &id)?;
            Ok(json!({ "profile": p }))
        })();
        UiEnvelope::from_result(res)
    })
    .await
    .unwrap_or_else(|e| UiEnvelope::from_result::<Value>(Err(AmmError::Other(e.to_string()))))
}

#[tauri::command]
async fn cmd_create_backup(note: Option<String>, pin: bool) -> UiEnvelope {
    tauri::async_runtime::spawn_blocking(move || {
        let data_dir = shared_data_dir();
        let res = (|| -> Result<Value, AmmError> {
            let mut mgr = ModManager::open(&data_dir)?;
            let game = mgr.resolve_game(None)?;
            let rec = mgr.manual_backup(&game, note, pin)?;
            Ok(json!({ "backup": rec }))
        })();
        UiEnvelope::from_result(res)
    })
    .await
    .unwrap_or_else(|e| UiEnvelope::from_result::<Value>(Err(AmmError::Other(e.to_string()))))
}

#[tauri::command]
async fn cmd_restore_backup(backup_id: String, confirm: bool) -> UiEnvelope {
    tauri::async_runtime::spawn_blocking(move || {
        let data_dir = shared_data_dir();
        let res = (|| -> Result<Value, AmmError> {
            let mut mgr = ModManager::open(&data_dir)?;
            let game = mgr.resolve_game(None)?;
            let rec = mgr.restore_backup(&game, &backup_id, confirm)?;
            Ok(json!({ "restored": rec }))
        })();
        UiEnvelope::from_result(res)
    })
    .await
    .unwrap_or_else(|e| UiEnvelope::from_result::<Value>(Err(AmmError::Other(e.to_string()))))
}

#[tauri::command]
async fn cmd_nexus_search(keyword: Option<String>, limit: u32) -> UiEnvelope {
    tauri::async_runtime::spawn_blocking(move || {
        UiEnvelope::from_result(nexus::search_mods(keyword.as_deref(), limit))
    })
    .await
    .unwrap_or_else(|e| UiEnvelope::from_result::<Value>(Err(AmmError::Other(e.to_string()))))
}

#[tauri::command]
async fn cmd_nexus_mod_details(mod_id: u32) -> UiEnvelope {
    tauri::async_runtime::spawn_blocking(move || {
        UiEnvelope::from_result(nexus::fetch_mod_details(mod_id))
    })
    .await
    .unwrap_or_else(|e| UiEnvelope::from_result::<Value>(Err(AmmError::Other(e.to_string()))))
}

#[tauri::command]
async fn cmd_nexus_check_updates() -> UiEnvelope {
    tauri::async_runtime::spawn_blocking(|| {
        let data_dir = shared_data_dir();
        let res = (|| -> Result<Value, AmmError> {
            let mut mgr = ModManager::open(&data_dir)?;
            let pairs: Vec<(String, u32, String)> = mgr
                .state
                .mods
                .values()
                .filter_map(|m| Some((m.id.clone(), m.nexus_mod_id?, m.current.version.clone())))
                .collect();
            let mut updates = Vec::new();
            for (local_id, nx_id, cur_ver) in pairs {
                if let Ok(remote) = nexus::fetch_mod_details(nx_id) {
                    if let Some(m) = mgr.state.mods.get_mut(&local_id) {
                        m.latest_remote_version = Some(remote.summary.version.clone());
                    }
                    if remote.summary.version != cur_ver {
                        updates.push(json!({
                            "mod_id": local_id,
                            "nexus_mod_id": nx_id,
                            "name": remote.summary.name,
                            "current": cur_ver,
                            "latest": remote.summary.version,
                            "page_url": remote.summary.page_url,
                        }));
                    }
                }
            }
            mgr.save()?;
            Ok(json!({ "updates": updates }))
        })();
        UiEnvelope::from_result(res)
    })
    .await
    .unwrap_or_else(|e| UiEnvelope::from_result::<Value>(Err(AmmError::Other(e.to_string()))))
}

#[tauri::command]
async fn cmd_nexus_auth(
    api_key: Option<String>,
    clear: bool,
    register_nxm: bool,
) -> UiEnvelope {
    tauri::async_runtime::spawn_blocking(move || {
        let res = (|| -> Result<Value, AmmError> {
            if clear {
                nexus::clear_api_key()?;
                return Ok(json!({ "cleared": true }));
            }
            if let Some(k) = api_key {
                let status = nexus::validate_account(&k)?;
                nexus::store_api_key(&k)?;
                if register_nxm {
                    nexus::register_nxm_protocol(&sibling_cli_exe())?;
                }
                return Ok(json!({ "account": status }));
            }
            if register_nxm {
                let cli = sibling_cli_exe();
                nexus::register_nxm_protocol(&cli)?;
                return Ok(json!({ "registered_exe": cli }));
            }
            let key = nexus::load_api_key()?;
            let status = nexus::validate_account(&key)?;
            Ok(json!({ "account": status }))
        })();
        UiEnvelope::from_result(res)
    })
    .await
    .unwrap_or_else(|e| UiEnvelope::from_result::<Value>(Err(AmmError::Other(e.to_string()))))
}

fn open_nexus_browser_window(
    app: &tauri::AppHandle,
    raw_url: &str,
    meta: Option<(u32, String)>,
) -> Result<(), AmmError> {
    let parsed_url = Url::parse(raw_url)
        .map_err(|e| AmmError::Other(format!("无效网页链接 ({raw_url}): {e}")))?;

    if let Ok(mut guard) = app.state::<NexusBrowserState>().pending_meta.lock() {
        *guard = meta;
    }

    let app_handle = app.clone();
    app.run_on_main_thread(move || {
        if let Some(existing) = app_handle.get_webview_window("nexus-browser") {
            let _ = existing.navigate(parsed_url);
            let _ = existing.set_focus();
            return;
        }

        let app_nav = app_handle.clone();
        let app_dl = app_handle.clone();
        let builder = WebviewWindowBuilder::new(
            &app_handle,
            "nexus-browser",
            WebviewUrl::External(parsed_url),
        )
        .title("Nexus Mods · 内置浏览窗（点击 Slow Download 后自动接管安装）")
        .inner_size(1080.0, 760.0)
        .center()
        .on_navigation(move |url| {
            if !url.scheme().eq_ignore_ascii_case("nxm") {
                return true;
            }

            let raw_nxm = url.as_str().to_string();
            if let Some(w) = app_nav.get_webview_window("nexus-browser") {
                let _ = w.close();
            }

            let app_bg = app_nav.clone();
            std::thread::spawn(move || match NxmUri::parse(&raw_nxm) {
                Ok(parsed) => {
                    let _ = app_bg.emit(
                        "amm://nexus-browser-event",
                        json!({ "kind": "nxm_started", "mod_id": parsed.mod_id }),
                    );
                    let res = (|| -> Result<Value, AmmError> {
                        let api_key = nexus::load_api_key()?;
                        let files = nexus::list_mod_files(&api_key, parsed.mod_id)?;
                        let meta = files.into_iter().find(|f| f.file_id == parsed.file_id);
                        let fname = meta
                            .as_ref()
                            .map(|f| f.file_name.clone())
                            .unwrap_or_else(|| {
                                format!("nexus-{}-{}.zip", parsed.mod_id, parsed.file_id)
                            });
                        let ver = meta.map(|f| f.version);

                        let mgr = ModManager::open(&shared_data_dir())?;
                        let dest = mgr.downloads_dir().join(fname);
                        drop(mgr);

                        nexus::download_mod_file(
                            &api_key,
                            parsed.mod_id,
                            parsed.file_id,
                            parsed.key.as_deref(),
                            parsed.expires.as_deref(),
                            &dest,
                        )?;
                        Ok(json!({
                            "path": dest,
                            "nexus_mod_id": parsed.mod_id,
                            "version": ver,
                        }))
                    })();

                    match res {
                        Ok(payload) => {
                            let _ = app_bg.emit("amm://nexus-downloaded", payload);
                        }
                        Err(e) => {
                            let _ = app_bg.emit(
                                "amm://nexus-browser-event",
                                json!({ "kind": "error", "message": e.to_string() }),
                            );
                        }
                    }
                }
                Err(e) => {
                    let _ = app_bg.emit(
                        "amm://nexus-browser-event",
                        json!({ "kind": "error", "message": e.to_string() }),
                    );
                }
            });

            false
        })
        .on_download(move |_webview, event| match event {
            DownloadEvent::Requested { url: _, destination } => {
                let downloads_dir = shared_data_dir().join("downloads");
                let _ = std::fs::create_dir_all(&downloads_dir);
                let fname = destination
                    .file_name()
                    .map(|n| n.to_os_string())
                    .unwrap_or_else(|| std::ffi::OsString::from("nexus-mod.zip"));
                *destination = downloads_dir.join(fname);
                let _ = app_dl.emit(
                    "amm://nexus-browser-event",
                    json!({ "kind": "http_started" }),
                );
                true
            }
            DownloadEvent::Finished {
                url: _,
                path,
                success,
            } => {
                if success && let Some(downloaded_path) = path {
                    let (nx_id, ver) = app_dl
                        .state::<NexusBrowserState>()
                        .pending_meta
                        .lock()
                        .ok()
                        .and_then(|g| g.clone())
                        .map(|(id, v)| (Some(id), Some(v)))
                        .unwrap_or((None, None));
                    if let Some(w) = app_dl.get_webview_window("nexus-browser") {
                        let _ = w.close();
                    }
                    let _ = app_dl.emit(
                        "amm://nexus-downloaded",
                        json!({
                            "path": downloaded_path,
                            "nexus_mod_id": nx_id,
                            "version": ver,
                        }),
                    );
                } else if !success {
                    let _ = app_dl.emit(
                        "amm://nexus-browser-event",
                        json!({ "kind": "error", "message": "内置浏览窗下载未能完成，请重试" }),
                    );
                }
                true
            }
            _ => true,
        });

        if let Err(e) = builder.build() {
            let _ = app_handle.emit(
                "amm://nexus-browser-event",
                json!({ "kind": "error", "message": format!("创建内置浏览窗失败: {e}") }),
            );
        }
    })
    .map_err(|e| AmmError::Other(format!("调度内置浏览窗失败: {e}")))
}

#[tauri::command]
async fn cmd_open_url(app: tauri::AppHandle, url: String) -> UiEnvelope {
    let trimmed = url.trim().to_string();
    if !trimmed.starts_with("https://") && !trimmed.starts_with("http://") {
        return UiEnvelope::from_result::<Value>(Err(AmmError::Other(
            "仅允许打开 http(s) 网页链接".to_string(),
        )));
    }
    if trimmed.contains("nexusmods.com") {
        let res = open_nexus_browser_window(&app, &trimmed, None)
            .map(|_| json!({ "opened_in_app": trimmed }));
        return UiEnvelope::from_result(res);
    }
    let res = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", &trimmed])
        .spawn()
        .map(|_| json!({ "opened": trimmed }))
        .map_err(|e| AmmError::Other(format!("无法打开浏览器: {e}")));
    UiEnvelope::from_result(res)
}

#[tauri::command]
async fn cmd_nexus_download_stage(app: tauri::AppHandle, mod_id: u32) -> UiEnvelope {
    tauri::async_runtime::spawn_blocking(move || {
        let data_dir = shared_data_dir();
        let res = (|| -> Result<Value, AmmError> {
            let api_key = nexus::load_api_key()?;
            let account = nexus::validate_account(&api_key)?;
            let files = nexus::list_mod_files(&api_key, mod_id)?;
            let chosen = files
                .iter()
                .find(|f| f.is_primary)
                .cloned()
                .or_else(|| files.into_iter().next())
                .ok_or_else(|| AmmError::Other("该 Mod 暂无可下载主文件".to_string()))?;

            if !account.is_premium {
                let web_url = format!(
                    "https://www.nexusmods.com/phantombladezero/mods/{mod_id}?tab=files&file_id={}&nmm=1",
                    chosen.file_id
                );
                open_nexus_browser_window(&app, &web_url, Some((mod_id, chosen.version.clone())))?;
                return Ok(json!({
                    "awaiting_browser": true,
                    "url": web_url,
                    "nexus_mod_id": mod_id,
                    "version": chosen.version,
                }));
            }

            let mgr = ModManager::open(&data_dir)?;
            let dest = mgr.downloads_dir().join(&chosen.file_name);
            drop(mgr);

            nexus::download_mod_file(&api_key, mod_id, chosen.file_id, None, None, &dest)?;
            Ok(json!({
                "awaiting_browser": false,
                "downloaded_path": dest,
                "nexus_mod_id": mod_id,
                "version": chosen.version,
            }))
        })();
        UiEnvelope::from_result(res)
    })
    .await
    .unwrap_or_else(|e| UiEnvelope::from_result::<Value>(Err(AmmError::Other(e.to_string()))))
}

fn spawn_activity_tailer(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        let data_dir = shared_data_dir();
        let log_path = activity_log_path(&data_dir);
        let state_path = data_dir.join("state.json");

        let mut offset = std::fs::metadata(&log_path)
            .map(|m| m.len())
            .unwrap_or(0);
        let mut last_state_mtime = std::fs::metadata(&state_path)
            .and_then(|m| m.modified())
            .ok();

        loop {
            std::thread::sleep(Duration::from_millis(160));

            if let Ok(meta) = std::fs::metadata(&log_path) {
                let len = meta.len();
                if len < offset {
                    // File was compacted/rotated
                    offset = len;
                } else if len > offset
                    && let Ok(mut file) = File::open(&log_path)
                    && file.seek(SeekFrom::Start(offset)).is_ok()
                {
                    let mut reader = BufReader::new(file);
                    let mut line = String::new();
                    while let Ok(bytes_read) = reader.read_line(&mut line) {
                        if bytes_read == 0 {
                            break;
                        }
                        offset += bytes_read as u64;
                        if let Ok(evt) = serde_json::from_str::<AgentActivityEvent>(line.trim()) {
                            let _ = app_handle.emit("amm://activity", evt);
                        }
                        line.clear();
                    }
                }
            }

            let cur_mtime = std::fs::metadata(&state_path)
                .and_then(|m| m.modified())
                .ok();
            if cur_mtime.is_some() && cur_mtime != last_state_mtime {
                last_state_mtime = cur_mtime;
                let _ = app_handle.emit("amm://state-changed", ());
            }
        }
    });
}

fn main() {
    tauri::Builder::default()
        .manage(NexusBrowserState {
            pending_meta: Mutex::new(None),
        })
        .setup(|app| {
            spawn_activity_tailer(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd_get_dashboard,
            cmd_get_recent_activity,
            cmd_pick_game_dir,
            cmd_pick_mod_file,
            cmd_pick_mod_folder,
            cmd_bind_game_dir,
            cmd_adopt_mods,
            cmd_inspect_source,
            cmd_install_mod,
            cmd_set_mod_enabled,
            cmd_rollback_mod,
            cmd_remove_mod,
            cmd_create_profile,
            cmd_switch_profile,
            cmd_create_backup,
            cmd_restore_backup,
            cmd_nexus_search,
            cmd_nexus_mod_details,
            cmd_nexus_check_updates,
            cmd_nexus_auth,
            cmd_nexus_download_stage,
            cmd_open_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PBZ-AMM desktop application");
}
