// Copyright 2026 PBZ-AMM Contributors
// SPDX-License-Identifier: Apache-2.0

//! Built-in stdio MCP (Model Context Protocol) JSON-RPC 2.0 server sharing `pbz-amm-core`.

use crate::build_inspect_ui_payload;
use pbz_amm_core::deployer::{InstallOptions, ModManager};
use pbz_amm_core::error::AmmError;
use pbz_amm_core::nexus;
use pbz_amm_core::telemetry::{ActivityPhase, AgentActivityEvent, emit_activity};
use serde_json::{Value, json};
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};

pub fn run_stdio_mcp_server(data_dir: &Path, default_game_dir: Option<&Path>) -> io::Result<()> {
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let line = line?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let req: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(e) => {
                let err_resp = json!({
                    "jsonrpc": "2.0",
                    "id": null,
                    "error": { "code": -32700, "message": format!("Parse error: {e}") }
                });
                writeln!(stdout, "{err_resp}")?;
                stdout.flush()?;
                continue;
            }
        };

        let id = req.get("id").cloned();
        let method = req.get("method").and_then(|v| v.as_str()).unwrap_or("");
        let params = req.get("params").cloned().unwrap_or_else(|| json!({}));

        // JSON-RPC notifications (no `id`) do not expect a response
        if id.is_none() {
            continue;
        }

        let response = match method {
            "initialize" => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {
                        "tools": {}
                    },
                    "serverInfo": {
                        "name": "pbz-amm",
                        "version": env!("CARGO_PKG_VERSION")
                    }
                }
            }),
            "ping" => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {}
            }),
            "tools/list" => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "tools": tool_definitions()
                }
            }),
            "tools/call" => {
                let tool_name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
                let payload = dispatch_tool(data_dir, default_game_dir, tool_name, &args);
                let is_error = payload.get("status").and_then(|s| s.as_str()) == Some("error");
                json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "content": [{
                            "type": "text",
                            "text": serde_json::to_string_pretty(&payload).unwrap_or_default()
                        }],
                        "isError": is_error
                    }
                })
            }
            other => json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": -32601,
                    "message": format!("Method not found: {other}")
                }
            }),
        };

        writeln!(stdout, "{response}")?;
        stdout.flush()?;
    }

    Ok(())
}

fn tool_definitions() -> Value {
    json!([
        {
            "name": "pbz_status",
            "description": "查看《影之刃零》安装路径、已装前置框架（UE4SS/ModsMenu/PBZModLoader/CPPBypass）、当前配置方案（Profile）、已装 Mod 与未接管野生 Mod 状态。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "game_dir": { "type": "string", "description": "可选，指定游戏根目录" }
                }
            }
        },
        {
            "name": "pbz_inspect",
            "description": "无损预检一个本地 Mod 压缩包或文件夹，返回识别出的分类、变体列表、内部 .pak/.utoc 资产路径及与当前已启用 Mod 的冲突报告。",
            "inputSchema": {
                "type": "object",
                "required": ["path"],
                "properties": {
                    "path": { "type": "string", "description": "压缩包 (.zip/.7z/.rar/.pak) 或目录路径" },
                    "game_dir": { "type": "string", "description": "可选，指定游戏根目录" }
                }
            }
        },
        {
            "name": "pbz_install",
            "description": "安装或更新本地 Mod。若存在多选一变体、文件/资产冲突或未知 DLL，会停下并返回 status='needs_selection' 供确认。",
            "inputSchema": {
                "type": "object",
                "required": ["path"],
                "properties": {
                    "path": { "type": "string" },
                    "select_variant": { "type": "string", "description": "多变体包中要安装的变体名" },
                    "name": { "type": "string", "description": "可选，自定义 Mod 显示名称" },
                    "nexus_id": { "type": "integer", "description": "可选，关联 Nexus Mod ID" },
                    "version": { "type": "string", "description": "可选，版本号标签" },
                    "allow_conflicts": { "type": "boolean", "default": false },
                    "allow_uncertain": { "type": "boolean", "default": false },
                    "game_dir": { "type": "string", "description": "可选，指定游戏根目录" }
                }
            }
        },
        {
            "name": "pbz_switch_profile",
            "description": "切换 Mod 配置方案（如 'vanilla' 纯净原版、'default' 默认配置等），自动备份存档且保持存档共用。",
            "inputSchema": {
                "type": "object",
                "required": ["profile_id"],
                "properties": {
                    "profile_id": { "type": "string" }
                }
            }
        },
        {
            "name": "pbz_rollback_mod",
            "description": "将指定 Mod 一键回滚至更新前的上一版本。",
            "inputSchema": {
                "type": "object",
                "required": ["mod_id"],
                "properties": {
                    "mod_id": { "type": "string" }
                }
            }
        },
        {
            "name": "pbz_nexus_search",
            "description": "在 Nexus Mods 官方《影之刃零》专区搜索 Mod（无需登录密钥即可搜索）。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "keyword": { "type": "string" },
                    "limit": { "type": "integer", "default": 10 }
                }
            }
        },
        {
            "name": "pbz_backup_saves",
            "description": "立即备份《影之刃零》本地存档文件夹，支持添加备注与永久保留标记。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "note": { "type": "string" },
                    "pin": { "type": "boolean", "default": false }
                }
            }
        }
    ])
}

fn dispatch_tool(
    data_dir: &Path,
    default_game_dir: Option<&Path>,
    name: &str,
    args: &Value,
) -> Value {
    let run = || -> Result<Value, AmmError> {
        let arg_game = args
            .get("game_dir")
            .and_then(|v| v.as_str())
            .map(PathBuf::from);
        let game_override = arg_game.as_deref().or(default_game_dir);

        match name {
            "pbz_nexus_search" => {
                let kw = args.get("keyword").and_then(|v| v.as_str());
                let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(10) as u32;
                let items = nexus::search_mods(kw, limit)?;
                Ok(json!({ "status": "ok", "results": items }))
            }
            "pbz_status" => {
                let mut mgr = ModManager::open(data_dir)?;
                let game = mgr.resolve_game(game_override)?;
                let frameworks = game.detect_frameworks();
                let unmanaged = mgr.scan_unmanaged_mods(&game)?;
                let conflicts = mgr.check_active_conflicts();
                Ok(json!({
                    "status": "ok",
                    "game": game,
                    "frameworks": frameworks,
                    "active_profile": mgr.state.active_profile_id,
                    "profiles": mgr.state.profiles,
                    "installed_mods": mgr.state.mods,
                    "unmanaged_candidates": unmanaged,
                    "active_conflicts": conflicts,
                    "save_backups_count": mgr.state.save_backups.len(),
                }))
            }
            "pbz_inspect" => {
                let p = PathBuf::from(
                    args.get("path")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default(),
                );
                let mut mgr = ModManager::open(data_dir)?;
                let game = mgr.resolve_game(game_override).ok();
                let (report, conflicts) = mgr.inspect_source(&p, game.as_ref())?;
                Ok(json!({
                    "status": "ok",
                    "report": report,
                    "conflicts_by_variant": conflicts,
                }))
            }
            "pbz_install" => {
                let p = PathBuf::from(
                    args.get("path")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default(),
                );
                let opts = InstallOptions {
                    name_override: args
                        .get("name")
                        .and_then(|v| v.as_str())
                        .map(ToString::to_string),
                    nexus_mod_id: args
                        .get("nexus_id")
                        .and_then(|v| v.as_u64())
                        .map(|n| n as u32),
                    version_override: args
                        .get("version")
                        .and_then(|v| v.as_str())
                        .map(ToString::to_string),
                    select_variant: args
                        .get("select_variant")
                        .and_then(|v| v.as_str())
                        .map(ToString::to_string),
                    allow_conflicts: args
                        .get("allow_conflicts")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false),
                    allow_uncertain_files: args
                        .get("allow_uncertain")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false),
                    ..Default::default()
                };
                let mut mgr = ModManager::open(data_dir)?;
                let game = mgr.resolve_game(game_override)?;
                let installed = mgr.install_source(&game, &p, &opts)?;
                Ok(json!({ "status": "ok", "installed": installed }))
            }
            "pbz_switch_profile" => {
                let pid = args
                    .get("profile_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let mut mgr = ModManager::open(data_dir)?;
                let game = mgr.resolve_game(game_override)?;
                let prof = mgr.switch_profile(&game, pid)?;
                Ok(json!({ "status": "ok", "active_profile": prof }))
            }
            "pbz_rollback_mod" => {
                let mid = args
                    .get("mod_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let mut mgr = ModManager::open(data_dir)?;
                let game = mgr.resolve_game(game_override)?;
                let m = mgr.rollback_mod(&game, mid)?;
                Ok(json!({ "status": "ok", "rolled_back": m }))
            }
            "pbz_backup_saves" => {
                let note = args
                    .get("note")
                    .and_then(|v| v.as_str())
                    .map(ToString::to_string);
                let pin = args.get("pin").and_then(|v| v.as_bool()).unwrap_or(false);
                let mut mgr = ModManager::open(data_dir)?;
                let game = mgr.resolve_game(game_override)?;
                let rec = mgr.manual_backup(&game, note, pin)?;
                Ok(json!({ "status": "ok", "backup": rec }))
            }
            other => Err(AmmError::Other(format!("未知的 MCP 工具名: {other}"))),
        }
    };

    let (tab_hint, target_sel, start_msg) = match name {
        "pbz_nexus_search" => {
            let kw = args.get("keyword").and_then(|v| v.as_str()).unwrap_or("");
            (
                Some("nexus"),
                Some("[data-agent-id='nexus-search-input']".to_string()),
                format!("MCP 搜索 Nexus 工坊：{kw}"),
            )
        }
        "pbz_status" => (
            Some("diagnostics"),
            Some("[data-agent-id='nav-diagnostics']".to_string()),
            "MCP 检查游戏目录与前置框架".to_string(),
        ),
        "pbz_inspect" => (
            Some("mods"),
            Some("[data-agent-id='dropzone']".to_string()),
            "MCP 预检本地 Mod 包".to_string(),
        ),
        "pbz_install" => (
            Some("mods"),
            Some("[data-agent-id='dropzone']".to_string()),
            "MCP 安装本地 Mod".to_string(),
        ),
        "pbz_switch_profile" => {
            let pid = args.get("profile_id").and_then(|v| v.as_str()).unwrap_or("default");
            (
                Some("mods"),
                Some(format!("[data-agent-id='profile:{pid}']")),
                format!("MCP 切换配置方案：{pid}"),
            )
        }
        "pbz_rollback_mod" => {
            let mid = args.get("mod_id").and_then(|v| v.as_str()).unwrap_or("");
            (
                Some("mods"),
                Some(format!("[data-agent-id='mod-row:{mid}']")),
                format!("MCP 回退 Mod 上一版本：{mid}"),
            )
        }
        "pbz_backup_saves" => (
            Some("backups"),
            Some("[data-agent-id='btn-backup-create']".to_string()),
            "MCP 备份本地存档".to_string(),
        ),
        _ => (None, None, format!("MCP 调用 {name}")),
    };

    emit_activity(
        data_dir,
        &AgentActivityEvent::new(
            "mcp",
            ActivityPhase::Started,
            name,
            tab_hint,
            target_sel.as_deref(),
            &start_msg,
            Some(args.clone()),
        ),
    );

    let arg_game_override = args
        .get("game_dir")
        .and_then(|v| v.as_str())
        .map(PathBuf::from);
    let effective_game_dir = arg_game_override.as_deref().or(default_game_dir);

    match run() {
        Ok(v) => {
            let extra = if name == "pbz_inspect" {
                let p = PathBuf::from(args.get("path").and_then(|x| x.as_str()).unwrap_or_default());
                json!({ "inspect": build_inspect_ui_payload(data_dir, &p, effective_game_dir) })
            } else if name == "pbz_nexus_search" {
                json!({
                    "keyword": args.get("keyword").and_then(|x| x.as_str()).unwrap_or(""),
                    "results": v.get("results").cloned().unwrap_or_else(|| json!([])),
                })
            } else {
                v.clone()
            };
            emit_activity(
                data_dir,
                &AgentActivityEvent::new(
                    "mcp",
                    ActivityPhase::Succeeded,
                    name,
                    tab_hint,
                    target_sel.as_deref(),
                    format!("{start_msg} · 完成"),
                    Some(extra),
                ),
            );
            v
        }
        Err(AmmError::NeedsSelection(prompt)) => {
            let inspect_payload = if name == "pbz_install" {
                let p = PathBuf::from(args.get("path").and_then(|x| x.as_str()).unwrap_or_default());
                build_inspect_ui_payload(data_dir, &p, effective_game_dir)
                    .map(|insp| json!({ "inspect": insp }))
            } else {
                None
            };
            emit_activity(
                data_dir,
                &AgentActivityEvent::new(
                    "mcp",
                    ActivityPhase::NeedsSelection,
                    name,
                    tab_hint,
                    target_sel.as_deref(),
                    &prompt.reason,
                    inspect_payload,
                ),
            );
            json!({
                "status": "needs_selection",
                "prompt": prompt,
            })
        }
        Err(err) => {
            let phase = match err.status() {
                pbz_amm_core::error::ResponseStatus::Blocked => ActivityPhase::Blocked,
                _ => ActivityPhase::Failed,
            };
            emit_activity(
                data_dir,
                &AgentActivityEvent::new(
                    "mcp",
                    phase,
                    name,
                    tab_hint,
                    target_sel.as_deref(),
                    err.to_string(),
                    None,
                ),
            );
            json!({
                "status": err.status(),
                "error": err.to_string(),
            })
        }
    }
}
