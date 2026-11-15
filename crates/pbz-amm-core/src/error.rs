// Copyright 2026 PBZ-AMM Contributors
// SPDX-License-Identifier: Apache-2.0

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Unified execution status returned in `--json` envelopes and MCP responses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResponseStatus {
    /// Operation completed cleanly.
    Ok,
    /// Ambiguity, variant choice, conflict, or unknown file requires user/Agent selection.
    NeedsSelection,
    /// Blocked by external runtime state (e.g., game is running, awaiting browser nxm:// click).
    Blocked,
    /// Operation failed due to an error.
    Error,
}

impl ResponseStatus {
    /// Deterministic CLI exit code for automation and AI Agents.
    pub fn exit_code(self) -> i32 {
        match self {
            Self::Ok => 0,
            Self::NeedsSelection => 10,
            Self::Blocked => 20,
            Self::Error => 1,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectionPrompt {
    pub reason: String,
    pub available_variants: Vec<String>,
    pub conflicts: Vec<String>,
    pub uncertain_files: Vec<String>,
}

impl std::fmt::Display for SelectionPrompt {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.reason)
    }
}

#[derive(Debug, Error)]
pub enum AmmError {
    #[error("未找到《影之刃零》安装目录，请通过 `--game-dir <路径>` 指定包含 ProjectPBZ 与 platform 的根目录: {0}")]
    GameNotFound(String),

    #[error("检测到《影之刃零》正在运行 ({0})，为保护游戏文件与存档，请先完全退出游戏后再执行此操作")]
    GameRunning(String),

    #[error("本地管理器数据目录正在被另一个 PBZ-AMM 实例（GUI 或 CLI）占用，请稍后重试")]
    StateLocked,

    #[error("此操作存在需要确认的选择项: {0}")]
    NeedsSelection(Box<SelectionPrompt>),

    #[error("压缩包路径安全检查未通过（检测到疑似路径穿越攻击）: {0}")]
    ZipSlipDetected(String),

    #[error("无法解析或解压文件 ({path}): {reason}")]
    ArchiveError { path: String, reason: String },

    #[error("未找到指定的 Mod: {0}")]
    ModNotFound(String),

    #[error("该 Mod 没有可回滚的上一版本备份: {0}")]
    NoRollbackVersion(String),

    #[error("未找到指定的配置方案 (Profile): {0}")]
    ProfileNotFound(String),

    #[error("未找到指定的存档备份: {0}")]
    BackupNotFound(String),

    #[error("恢复存档属于高风险操作，必须显式传入确认参数 (--confirm)")]
    RestoreConfirmationRequired,

    #[error("尚未配置 Nexus Mods API Key，请先运行 `pbz-amm nexus auth --set-key`")]
    NexusAuthRequired,

    #[error("当前 Nexus 账号为免费账号，已在浏览器打开下载确认页，请点击网页下载按钮以通过 nxm:// 自动接管: {url}")]
    NexusAwaitingBrowserConfirm { url: String },

    #[error("无效的 nxm:// 链接: {0}")]
    InvalidNxmUri(String),

    #[error("网络请求失败: {0}")]
    Network(String),

    #[error("文件读写错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON 序列化/解析错误: {0}")]
    Json(#[from] serde_json::Error),

    #[error("{0}")]
    Other(String),
}

impl AmmError {
    pub fn status(&self) -> ResponseStatus {
        match self {
            Self::NeedsSelection(_) | Self::RestoreConfirmationRequired => {
                ResponseStatus::NeedsSelection
            }
            Self::GameRunning(_)
            | Self::StateLocked
            | Self::NexusAwaitingBrowserConfirm { .. } => ResponseStatus::Blocked,
            _ => ResponseStatus::Error,
        }
    }
}

pub type Result<T> = std::result::Result<T, AmmError>;
