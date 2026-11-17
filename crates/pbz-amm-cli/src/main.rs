// Copyright 2026 PBZ-AMM Contributors
// SPDX-License-Identifier: Apache-2.0

mod mcp;

use clap::{Parser, Subcommand};
use pbz_amm_core::deployer::{InstallOptions, ModManager};
use pbz_amm_core::error::{AmmError, ResponseStatus};
use pbz_amm_core::nexus::{self, NxmUri};
use pbz_amm_core::telemetry::{
    ActivityPhase, AgentActivityEvent, emit_activity, resolve_default_data_dir,
};
use serde::Serialize;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

#[derive(Parser, Debug)]
#[command(
    name = "pbz-amm",
    version,
    about = "PBZ-AMM (Auto Mod Manager): 《影之刃零》专属开源 Mod 管理器 (CLI + Agent Skill + MCP Core)"
)]
struct Cli {
    /// 以结构化 JSON 输出结果（供 AI Agent 与自动化脚本编排）
    #[arg(long, global = true)]
    json: bool,

    /// 指定《影之刃零》游戏根目录（首次指定后自动记忆）
    #[arg(long, global = true)]
    game_dir: Option<PathBuf>,

    /// 指定 PBZ-AMM 本地数据与仓库目录（默认为程序旁 Data/ 目录）
    #[arg(long, global = true)]
    data_dir: Option<PathBuf>,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// 查看游戏路径、前置框架、当前配置方案、已装 Mod 及野生未接管 Mod 状态
    Status,

    /// 扫描或接管已有野生 Mod（不传参数仅扫描展示；传 ID 或 `all` 确认接管）
    Adopt { ids: Vec<String> },

    /// 无损预检本地压缩包或目录，输出分类、变体列表及容器内部资产冲突
    Inspect { path: PathBuf },

    /// 安装或更新本地 Mod（遇到冲突、多选一变体或未知 DLL 时自动停下待选）
    Install {
        path: PathBuf,
        #[arg(long = "select")]
        select_variant: Option<String>,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        nexus_id: Option<u32>,
        #[arg(long)]
        version: Option<String>,
        #[arg(long)]
        allow_conflicts: bool,
        #[arg(long)]
        allow_uncertain: bool,
    },

    /// 在当前配置方案中启用指定 Mod
    Enable { mod_id: String },

    /// 在当前配置方案中禁用指定 Mod
    Disable { mod_id: String },

    /// 将指定 Mod 一键回滚至更新前的上一版本
    Rollback { mod_id: String },

    /// 彻底卸载受管 Mod
    Remove { mod_id: String },

    /// 检查当前激活方案中的文件级与 .pak/.utoc 内部资产冲突
    Conflicts,

    /// 管理多套配置方案（如 vanilla 纯净原版 / 外观 / 练习，存档共用）
    Profile {
        #[command(subcommand)]
        action: ProfileAction,
    },

    /// 管理本地存档备份与安全恢复
    Backup {
        #[command(subcommand)]
        action: BackupAction,
    },

    /// Nexus Mods 搜索、更新检测、账号绑定与下载接管
    Nexus {
        #[command(subcommand)]
        action: NexusAction,
    },

    /// 启动内置本地 stdio MCP 服务
    Mcp {
        #[command(subcommand)]
        action: McpAction,
    },
}

#[derive(Subcommand, Debug)]
enum ProfileAction {
    List,
    Create {
        id: String,
        #[arg(long)]
        name: Option<String>,
        #[arg(long, default_value = "")]
        desc: String,
        #[arg(long)]
        clone_active: bool,
    },
    Switch {
        id: String,
    },
}

#[derive(Subcommand, Debug)]
enum BackupAction {
    List,
    Create {
        #[arg(long)]
        note: Option<String>,
        #[arg(long)]
        pin: bool,
    },
    Restore {
        backup_id: String,
        #[arg(long)]
        confirm: bool,
    },
}

#[derive(Subcommand, Debug)]
enum NexusAction {
    Search {
        keyword: Option<String>,
        #[arg(long, default_value_t = 10)]
        limit: u32,
    },
    Info {
        mod_id: u32,
    },
    CheckUpdates,
    Auth {
        #[arg(long)]
        set_key: Option<String>,
        #[arg(long)]
        clear: bool,
        #[arg(long)]
        register_nxm: bool,
    },
    Download {
        mod_id: u32,
        #[arg(long)]
        file_id: Option<u64>,
        #[arg(long)]
        install: bool,
        #[arg(long = "select")]
        select_variant: Option<String>,
    },
    HandleNxm {
        uri: String,
    },
}

#[derive(Subcommand, Debug)]
enum McpAction {
    Serve,
}

#[derive(Serialize)]
struct JsonEnvelope<T: Serialize> {
    status: ResponseStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    selection: Option<pbz_amm_core::error::SelectionPrompt>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn default_data_dir() -> PathBuf {
    resolve_default_data_dir()
}

pub(crate) fn build_inspect_ui_payload(
    data_dir: &Path,
    path: &Path,
    game_override: Option<&Path>,
) -> Option<Value> {
    let mut mgr = ModManager::open(data_dir).ok()?;
    let game = mgr.resolve_game(game_override).ok();
    let (report, conflicts) = mgr.inspect_source(path, game.as_ref()).ok()?;
    let mut conflict_texts = serde_json::Map::new();
    for (k, v) in &conflicts {
        conflict_texts.insert(k.clone(), json!(v.to_messages()));
    }
    Some(json!({
        "source_path": path.display().to_string(),
        "report": report,
        "conflict_texts": conflict_texts,
    }))
}

fn describe_cli_intent(cmd: &Commands) -> (&'static str, Option<&'static str>, Option<String>, String, Option<Value>) {
    match cmd {
        Commands::Status => (
            "status",
            Some("diagnostics"),
            Some("[data-agent-id='nav-diagnostics']".to_string()),
            "检查游戏目录与前置框架状态".to_string(),
            None,
        ),
        Commands::Adopt { ids } => {
            if ids.is_empty() {
                (
                    "adopt_scan",
                    Some("mods"),
                    Some("[data-agent-id='wild-adopt-panel']".to_string()),
                    "扫描游戏目录中已有的手动安装 Mod".to_string(),
                    None,
                )
            } else {
                (
                    "adopt",
                    Some("mods"),
                    Some("[data-agent-id='btn-adopt-wild']".to_string()),
                    format!("接管已有 Mod：{}", ids.join(", ")),
                    None,
                )
            }
        }
        Commands::Inspect { path } => (
            "inspect",
            Some("mods"),
            Some("[data-agent-id='dropzone']".to_string()),
            format!("预检 Mod 包：{}", path.file_name().and_then(|s| s.to_str()).unwrap_or("本地文件")),
            None,
        ),
        Commands::Install { path, select_variant, .. } => (
            "install",
            Some("mods"),
            Some("[data-agent-id='dropzone']".to_string()),
            match select_variant {
                Some(v) => format!("安装 Mod：{}（版本：{v}）", path.file_name().and_then(|s| s.to_str()).unwrap_or("本地文件")),
                None => format!("安装 Mod：{}", path.file_name().and_then(|s| s.to_str()).unwrap_or("本地文件")),
            },
            None,
        ),
        Commands::Enable { mod_id } => (
            "enable",
            Some("mods"),
            Some(format!("[data-agent-id='mod-switch:{mod_id}']")),
            format!("启用 Mod：{mod_id}"),
            Some(json!({ "mod_id": mod_id })),
        ),
        Commands::Disable { mod_id } => (
            "disable",
            Some("mods"),
            Some(format!("[data-agent-id='mod-switch:{mod_id}']")),
            format!("停用 Mod：{mod_id}"),
            Some(json!({ "mod_id": mod_id })),
        ),
        Commands::Rollback { mod_id } => (
            "rollback",
            Some("mods"),
            Some(format!("[data-agent-id='mod-row:{mod_id}']")),
            format!("回退 Mod 至上一版本：{mod_id}"),
            Some(json!({ "mod_id": mod_id })),
        ),
        Commands::Remove { mod_id } => (
            "remove",
            Some("mods"),
            Some(format!("[data-agent-id='mod-row:{mod_id}']")),
            format!("卸载 Mod：{mod_id}"),
            Some(json!({ "mod_id": mod_id })),
        ),
        Commands::Conflicts => (
            "conflicts",
            Some("diagnostics"),
            Some("[data-agent-id='conflict-audit-card']".to_string()),
            "检测文件与 .pak / .utoc 内部资产冲突".to_string(),
            None,
        ),
        Commands::Profile { action } => match action {
            ProfileAction::List => (
                "profile_list",
                Some("mods"),
                None,
                "读取配置方案列表".to_string(),
                None,
            ),
            ProfileAction::Create { id, .. } => (
                "profile_create",
                Some("mods"),
                Some("[data-agent-id='btn-new-profile']".to_string()),
                format!("新建配置方案：{id}"),
                None,
            ),
            ProfileAction::Switch { id } => (
                "profile_switch",
                Some("mods"),
                Some(format!("[data-agent-id='profile:{id}']")),
                format!("切换配置方案：{id}"),
                Some(json!({ "profile_id": id })),
            ),
        },
        Commands::Backup { action } => match action {
            BackupAction::List => (
                "backup_list",
                Some("backups"),
                Some("[data-agent-id='nav-backups']".to_string()),
                "查看本地存档备份列表".to_string(),
                None,
            ),
            BackupAction::Create { note, .. } => (
                "backup_create",
                Some("backups"),
                Some("[data-agent-id='btn-backup-create']".to_string()),
                match note {
                    Some(n) => format!("创建存档备份（{n}）"),
                    None => "创建本地存档备份".to_string(),
                },
                None,
            ),
            BackupAction::Restore { backup_id, .. } => (
                "backup_restore",
                Some("backups"),
                Some(format!("[data-agent-id='backup-row:{backup_id}']")),
                format!("恢复存档备份：{backup_id}"),
                None,
            ),
        },
        Commands::Nexus { action } => match action {
            NexusAction::Search { keyword, .. } => {
                let kw = keyword.clone().unwrap_or_default();
                (
                    "nexus_search",
                    Some("nexus"),
                    Some("[data-agent-id='nexus-search-input']".to_string()),
                    if kw.is_empty() {
                        "获取 Nexus 热门 Mod 列表".to_string()
                    } else {
                        format!("搜索 Nexus 工坊：{kw}")
                    },
                    Some(json!({ "keyword": kw })),
                )
            }
            NexusAction::Info { mod_id } => (
                "nexus_info",
                Some("nexus"),
                Some(format!("[data-agent-id='nexus-card:{mod_id}']")),
                format!("读取 Nexus Mod #{mod_id} 详情"),
                Some(json!({ "mod_id": mod_id })),
            ),
            NexusAction::CheckUpdates => (
                "nexus_check_updates",
                Some("nexus"),
                Some("[data-agent-id='btn-nexus-updates']".to_string()),
                "检查已装 Mod 更新".to_string(),
                None,
            ),
            NexusAction::Auth { .. } => (
                "nexus_auth",
                Some("settings"),
                Some("[data-agent-id='nexus-auth-card']".to_string()),
                "更新 Nexus 账号认证设置".to_string(),
                None,
            ),
            NexusAction::Download { mod_id, .. } => (
                "nexus_download",
                Some("nexus"),
                Some(format!("[data-agent-id='nexus-dl:{mod_id}']")),
                format!("下载 Nexus Mod #{mod_id}"),
                Some(json!({ "mod_id": mod_id })),
            ),
            NexusAction::HandleNxm { .. } => (
                "nexus_nxm",
                Some("mods"),
                Some("[data-agent-id='dropzone']".to_string()),
                "接收浏览器 nxm:// 下载链接".to_string(),
                None,
            ),
        },
        Commands::Mcp { .. } => ("mcp", None, None, String::new(), None),
    }
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let data_dir = cli.data_dir.clone().unwrap_or_else(default_data_dir);
    let game_override = cli.game_dir.as_deref();

    if let Commands::Mcp {
        action: McpAction::Serve,
    } = &cli.command
    {
        if let Err(e) = mcp::run_stdio_mcp_server(&data_dir, game_override) {
            eprintln!("MCP server error: {e}");
            return ExitCode::from(1);
        }
        return ExitCode::SUCCESS;
    }

    let (act_name, tab_hint, target_sel, start_summary, start_payload) =
        describe_cli_intent(&cli.command);
    emit_activity(
        &data_dir,
        &AgentActivityEvent::new(
            "cli",
            ActivityPhase::Started,
            act_name,
            tab_hint,
            target_sel.as_deref(),
            &start_summary,
            start_payload,
        ),
    );

    let mut pending_inspect: Option<(std::path::PathBuf, Option<u32>, Option<String>)> = None;
    match execute_cli(&cli, &data_dir, game_override, &mut pending_inspect) {
        Ok((human_msg, json_val)) => {
            // Enrich UI live event payload so the GUI reflects search results, details, or inspect modal immediately!
            let (done_sel, done_summary, ui_payload) = match &cli.command {
                Commands::Inspect { path } => (
                    target_sel.clone(),
                    "预检完成，已同步至桌面端预检窗口".to_string(),
                    json!({
                        "inspect": build_inspect_ui_payload(&data_dir, path, game_override)
                    }),
                ),
                Commands::Install { .. } => {
                    let mid = json_val
                        .pointer("/installed/id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let mname = json_val
                        .pointer("/installed/name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Mod");
                    (
                        if mid.is_empty() {
                            target_sel.clone()
                        } else {
                            Some(format!("[data-agent-id='mod-row:{mid}']"))
                        },
                        format!("已安装：{mname}"),
                        json!({ "installed_id": mid }),
                    )
                }
                Commands::Nexus {
                    action: NexusAction::Search { keyword, .. },
                } => {
                    let count = json_val
                        .get("results")
                        .and_then(|r| r.as_array())
                        .map(|a| a.len())
                        .unwrap_or(0);
                    (
                        Some("[data-agent-id='btn-nexus-search']".to_string()),
                        format!("搜索完成，共找到 {count} 个 Mod"),
                        json!({
                            "keyword": keyword.clone().unwrap_or_default(),
                            "results": json_val.get("results").cloned().unwrap_or_else(|| json!([]))
                        }),
                    )
                }
                Commands::Nexus {
                    action: NexusAction::Info { .. },
                } => (
                    target_sel.clone(),
                    "已加载 Mod 详情与前置信息".to_string(),
                    json!({ "details": json_val.clone() }),
                ),
                Commands::Nexus {
                    action: NexusAction::CheckUpdates,
                } => (
                    target_sel.clone(),
                    human_msg.clone(),
                    json_val.clone(),
                ),
                _ => (
                    target_sel.clone(),
                    human_msg.lines().next().unwrap_or("操作完成").to_string(),
                    json!({}),
                ),
            };

            emit_activity(
                &data_dir,
                &AgentActivityEvent::new(
                    "cli",
                    ActivityPhase::Succeeded,
                    act_name,
                    tab_hint,
                    done_sel.as_deref(),
                    done_summary,
                    Some(ui_payload),
                ),
            );

            if cli.json {
                let env = JsonEnvelope {
                    status: ResponseStatus::Ok,
                    data: Some(json_val),
                    selection: None,
                    error: None,
                };
                println!("{}", serde_json::to_string_pretty(&env).unwrap());
            } else {
                println!("{human_msg}");
            }
            ExitCode::from(ResponseStatus::Ok.exit_code() as u8)
        }
        Err(err) => {
            let status = err.status();
            let code = status.exit_code() as u8;
            let phase = match status {
                ResponseStatus::NeedsSelection => ActivityPhase::NeedsSelection,
                ResponseStatus::Blocked => ActivityPhase::Blocked,
                _ => ActivityPhase::Failed,
            };

            // Option A: If `install` or `handle-nxm` paused on NeedsSelection, attach full InspectPayload so GUI auto-opens InspectModal!
            let err_payload = if matches!(status, ResponseStatus::NeedsSelection) {
                if let Some((ref p, nid, ref ver)) = pending_inspect {
                    build_inspect_ui_payload(&data_dir, p, game_override).map(|insp| {
                        json!({
                            "inspect": insp,
                            "nexus_id": nid,
                            "version": ver,
                        })
                    })
                } else if let Commands::Install {
                    path,
                    nexus_id,
                    version,
                    ..
                } = &cli.command
                {
                    build_inspect_ui_payload(&data_dir, path, game_override).map(|insp| {
                        json!({
                            "inspect": insp,
                            "nexus_id": nexus_id,
                            "version": version,
                        })
                    })
                } else {
                    None
                }
            } else {
                None
            };

            emit_activity(
                &data_dir,
                &AgentActivityEvent::new(
                    "cli",
                    phase,
                    act_name,
                    tab_hint,
                    target_sel.as_deref(),
                    err.to_string(),
                    err_payload,
                ),
            );

            if cli.json {
                let (sel, msg) = match err {
                    AmmError::NeedsSelection(p) => {
                        let r = p.reason.clone();
                        (Some(*p), Some(r))
                    }
                    other => (None, Some(other.to_string())),
                };
                let env = JsonEnvelope::<serde_json::Value> {
                    status,
                    data: None,
                    selection: sel,
                    error: msg,
                };
                println!("{}", serde_json::to_string_pretty(&env).unwrap());
            } else if let AmmError::NeedsSelection(p) = &err {
                eprintln!("⏸ 需要确认或选择: {}", p.reason);
                for v in &p.available_variants {
                    eprintln!("  • 可选变体: {v} (--select \"{v}\")");
                }
                for c in &p.conflicts {
                    eprintln!("  • 冲突项: {c}");
                }
                for u in &p.uncertain_files {
                    eprintln!("  • 待确认文件: {u}");
                }
            } else {
                eprintln!("❌ {err}");
            }
            ExitCode::from(code)
        }
    }
}

fn execute_cli(
    cli: &Cli,
    data_dir: &Path,
    game_override: Option<&Path>,
    pending_inspect: &mut Option<(std::path::PathBuf, Option<u32>, Option<String>)>,
) -> Result<(String, serde_json::Value), AmmError> {
    match &cli.command {
        Commands::Status => {
            let mut mgr = ModManager::open(data_dir)?;
            let game = mgr.resolve_game(game_override)?;
            let fw = game.detect_frameworks();
            let unmanaged = mgr.scan_unmanaged_mods(&game)?;
            let conflicts = mgr.check_active_conflicts();
            let summary = format!(
                "游戏路径: {} ({:?})\n主程序:   {}\n前置框架: UE4SS={} | ModsMenu={} | PBZModLoader={} | CPPBypass={} | OutfitFramework={}\n当前方案: {} | 受管Mod: {} | 未接管野生项: {} | 存档备份: {}",
                game.root_dir.display(),
                game.store,
                game.shipping_exe.display(),
                fw.ue4ss,
                fw.mods_menu,
                fw.pbz_mod_loader,
                fw.cpp_pak_bypass,
                fw.outfit_framework,
                mgr.state.active_profile_id,
                mgr.state.mods.len(),
                unmanaged.len(),
                mgr.state.save_backups.len()
            );
            Ok((
                summary,
                json!({
                    "game": game,
                    "frameworks": fw,
                    "active_profile_id": mgr.state.active_profile_id,
                    "profiles": mgr.state.profiles,
                    "mods": mgr.state.mods,
                    "unmanaged": unmanaged,
                    "conflicts": conflicts,
                }),
            ))
        }
        Commands::Adopt { ids } => {
            let mut mgr = ModManager::open(data_dir)?;
            let game = mgr.resolve_game(game_override)?;
            if ids.is_empty() {
                let cands = mgr.scan_unmanaged_mods(&game)?;
                let mut lines = vec![format!("扫描到 {} 项未接管的已有 Mod:", cands.len())];
                for c in &cands {
                    lines.push(format!("  - `{}` ({}, {:?})", c.id, c.name, c.target));
                }
                return Ok((lines.join("\n"), json!({ "candidates": cands })));
            }
            let adopted = mgr.adopt_unmanaged_mods(&game, ids)?;
            Ok((
                format!("已接管 {} 个 Mod", adopted.len()),
                json!({ "adopted": adopted }),
            ))
        }
        Commands::Inspect { path } => {
            let mut mgr = ModManager::open(data_dir)?;
            let game = mgr.resolve_game(game_override).ok();
            let (report, conflicts) = mgr.inspect_source(path, game.as_ref())?;
            let msg = format!(
                "名称: {} | NexusID: {:?} | 变体数: {}",
                report.suggested_name,
                report.nexus_mod_id_hint,
                report.variants.len()
            );
            Ok((msg, json!({ "report": report, "conflicts": conflicts })))
        }
        Commands::Install {
            path,
            select_variant,
            name,
            nexus_id,
            version,
            allow_conflicts,
            allow_uncertain,
        } => {
            let mut mgr = ModManager::open(data_dir)?;
            let game = mgr.resolve_game(game_override)?;
            let installed = mgr.install_source(
                &game,
                path,
                &InstallOptions {
                    mod_id_override: None,
                    name_override: name.clone(),
                    nexus_mod_id: *nexus_id,
                    version_override: version.clone(),
                    select_variant: select_variant.clone(),
                    allow_conflicts: *allow_conflicts,
                    allow_uncertain_files: *allow_uncertain,
                },
            )?;
            Ok((
                format!(
                    "已安装 `{}` (ID: {}, 版本: {})",
                    installed.name, installed.id, installed.current.version
                ),
                json!({ "installed": installed }),
            ))
        }
        Commands::Enable { mod_id } => {
            let mut mgr = ModManager::open(data_dir)?;
            let game = mgr.resolve_game(game_override)?;
            mgr.set_mod_enabled(&game, mod_id, true)?;
            Ok((format!("已启用 `{mod_id}`"), json!({ "mod_id": mod_id, "enabled": true })))
        }
        Commands::Disable { mod_id } => {
            let mut mgr = ModManager::open(data_dir)?;
            let game = mgr.resolve_game(game_override)?;
            mgr.set_mod_enabled(&game, mod_id, false)?;
            Ok((format!("已禁用 `{mod_id}`"), json!({ "mod_id": mod_id, "enabled": false })))
        }
        Commands::Rollback { mod_id } => {
            let mut mgr = ModManager::open(data_dir)?;
            let game = mgr.resolve_game(game_override)?;
            let m = mgr.rollback_mod(&game, mod_id)?;
            Ok((
                format!("已回滚 `{}` 至版本 `{}`", m.name, m.current.version),
                json!({ "mod": m }),
            ))
        }
        Commands::Remove { mod_id } => {
            let mut mgr = ModManager::open(data_dir)?;
            let game = mgr.resolve_game(game_override)?;
            mgr.uninstall_mod(&game, mod_id)?;
            Ok((format!("已卸载 `{mod_id}`"), json!({ "removed": mod_id })))
        }
        Commands::Conflicts => {
            let mgr = ModManager::open(data_dir)?;
            let summary = mgr.check_active_conflicts();
            let msgs = summary.to_messages();
            let txt = if msgs.is_empty() {
                "当前无冲突".to_string()
            } else {
                msgs.join("\n")
            };
            Ok((txt, json!(summary)))
        }
        Commands::Profile { action } => {
            let mut mgr = ModManager::open(data_dir)?;
            match action {
                ProfileAction::List => Ok((
                    format!("当前激活方案: {}", mgr.state.active_profile_id),
                    json!({
                        "active": mgr.state.active_profile_id,
                        "profiles": mgr.state.profiles,
                    }),
                )),
                ProfileAction::Create {
                    id,
                    name,
                    desc,
                    clone_active,
                } => {
                    let disp = name.clone().unwrap_or_else(|| id.clone());
                    let p = mgr.create_profile(id, &disp, desc, *clone_active)?;
                    Ok((format!("已创建方案 `{}`", p.id), json!(p)))
                }
                ProfileAction::Switch { id } => {
                    let game = mgr.resolve_game(game_override)?;
                    let p = mgr.switch_profile(&game, id)?;
                    Ok((format!("已切换至方案 `{}` ({})", p.id, p.display_name), json!(p)))
                }
            }
        }
        Commands::Backup { action } => {
            let mut mgr = ModManager::open(data_dir)?;
            match action {
                BackupAction::List => Ok((
                    format!("共 {} 份存档备份", mgr.state.save_backups.len()),
                    json!({ "backups": mgr.state.save_backups }),
                )),
                BackupAction::Create { note, pin } => {
                    let game = mgr.resolve_game(game_override)?;
                    let rec = mgr.manual_backup(&game, note.clone(), *pin)?;
                    Ok(("存档备份已完成".to_string(), json!({ "backup": rec })))
                }
                BackupAction::Restore { backup_id, confirm } => {
                    let game = mgr.resolve_game(game_override)?;
                    let rec = mgr.restore_backup(&game, backup_id, *confirm)?;
                    Ok((format!("已恢复备份 `{}`", rec.id), json!({ "restored": rec })))
                }
            }
        }
        Commands::Nexus { action } => match action {
            NexusAction::Search { keyword, limit } => {
                let res = nexus::search_mods(keyword.as_deref(), *limit)?;
                let lines: Vec<String> = res
                    .iter()
                    .map(|m| format!("[#{}] {} (v{}) by {} - ⬇{}", m.mod_id, m.name, m.version, m.author, m.downloads))
                    .collect();
                Ok((lines.join("\n"), json!({ "results": res })))
            }
            NexusAction::Info { mod_id } => {
                let info = nexus::fetch_mod_details(*mod_id)?;
                Ok((
                    format!("[#{}] {} (v{})", info.summary.mod_id, info.summary.name, info.summary.version),
                    json!(info),
                ))
            }
            NexusAction::CheckUpdates => {
                let mut mgr = ModManager::open(data_dir)?;
                let mut updates = Vec::new();
                let pairs: Vec<(String, u32, String)> = mgr
                    .state
                    .mods
                    .values()
                    .filter_map(|m| Some((m.id.clone(), m.nexus_mod_id?, m.current.version.clone())))
                    .collect();
                for (id, nx_id, cur) in pairs {
                    if let Ok(remote) = nexus::fetch_mod_details(nx_id) {
                        if let Some(m) = mgr.state.mods.get_mut(&id) {
                            m.latest_remote_version = Some(remote.summary.version.clone());
                        }
                        if remote.summary.version != cur {
                            updates.push(json!({
                                "mod_id": id,
                                "nexus_mod_id": nx_id,
                                "current": cur,
                                "latest": remote.summary.version,
                            }));
                        }
                    }
                }
                mgr.save()?;
                Ok((format!("发现 {} 项更新", updates.len()), json!({ "updates": updates })))
            }
            NexusAction::Auth {
                set_key,
                clear,
                register_nxm,
            } => {
                if *clear {
                    nexus::clear_api_key()?;
                    return Ok(("已清除 API Key".to_string(), json!({ "cleared": true })));
                }
                if let Some(k) = set_key {
                    let st = nexus::validate_account(k)?;
                    nexus::store_api_key(k)?;
                    if *register_nxm && let Ok(exe) = std::env::current_exe() {
                        nexus::register_nxm_protocol(&exe)?;
                    }
                    return Ok((format!("已认证账号: {} (Premium={})", st.name, st.is_premium), json!(st)));
                }
                if *register_nxm {
                    let exe = std::env::current_exe()?;
                    nexus::register_nxm_protocol(&exe)?;
                    return Ok(("已注册 nxm:// 协议".to_string(), json!({ "exe": exe })));
                }
                let k = nexus::load_api_key()?;
                let st = nexus::validate_account(&k)?;
                Ok((format!("当前账号: {} (Premium={})", st.name, st.is_premium), json!(st)))
            }
            NexusAction::Download {
                mod_id,
                file_id,
                install,
                select_variant,
            } => {
                let api_key = nexus::load_api_key()?;
                let files = nexus::list_mod_files(&api_key, *mod_id)?;
                let chosen = match file_id {
                    Some(fid) => files
                        .into_iter()
                        .find(|f| f.file_id == *fid)
                        .ok_or_else(|| AmmError::Other(format!("未找到 file_id={fid}")))?,
                    None => files
                        .iter()
                        .find(|f| f.is_primary)
                        .cloned()
                        .or_else(|| files.into_iter().next())
                        .ok_or_else(|| AmmError::Other("无可用主文件".to_string()))?,
                };
                let mgr = ModManager::open(data_dir)?;
                let dest = mgr.downloads_dir().join(&chosen.file_name);
                drop(mgr);
                nexus::download_mod_file(&api_key, *mod_id, chosen.file_id, None, None, &dest)?;
                if *install {
                    let mut mgr = ModManager::open(data_dir)?;
                    let game = mgr.resolve_game(game_override)?;
                    let inst = mgr.install_source(
                        &game,
                        &dest,
                        &InstallOptions {
                            nexus_mod_id: Some(*mod_id),
                            version_override: Some(chosen.version),
                            select_variant: select_variant.clone(),
                            ..Default::default()
                        },
                    )?;
                    Ok((format!("已下载并安装 `{}`", inst.name), json!({ "installed": inst })))
                } else {
                    Ok((format!("已下载至 {}", dest.display()), json!({ "downloaded": dest })))
                }
            }
            NexusAction::HandleNxm { uri } => {
                let parsed = NxmUri::parse(uri)?;
                let api_key = nexus::load_api_key()?;
                let files = nexus::list_mod_files(&api_key, parsed.mod_id)?;
                let meta = files.into_iter().find(|f| f.file_id == parsed.file_id);
                let fname = meta
                    .as_ref()
                    .map(|f| f.file_name.clone())
                    .unwrap_or_else(|| format!("nexus-{}-{}.zip", parsed.mod_id, parsed.file_id));
                let mgr = ModManager::open(data_dir)?;
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
                let version_opt = meta.map(|f| f.version);
                *pending_inspect = Some((dest.clone(), Some(parsed.mod_id), version_opt.clone()));
                let mut mgr = ModManager::open(data_dir)?;
                let game = mgr.resolve_game(game_override)?;
                let inst = mgr.install_source(
                    &game,
                    &dest,
                    &InstallOptions {
                        nexus_mod_id: Some(parsed.mod_id),
                        version_override: version_opt,
                        ..Default::default()
                    },
                )?;
                Ok((format!("已通过 nxm:// 安装 `{}`", inst.name), json!({ "installed": inst })))
            }
        },
        Commands::Mcp { .. } => unreachable!(),
    }
}
