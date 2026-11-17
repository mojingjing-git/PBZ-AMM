// Copyright 2026 PBZ-AMM Contributors
// SPDX-License-Identifier: Apache-2.0

//! Shared cross-process telemetry bus (`<Data>/activity.jsonl`) enabling the Tauri Wuxia GUI
//! to visualize live CLI & MCP Agent operations ("悬丝傀儡 · 无形执剑") in real time.

use chrono::Local;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static EVENT_SEQ: AtomicU64 = AtomicU64::new(1);
const ACTIVITY_FILE_NAME: &str = "activity.jsonl";
const MAX_ACTIVITY_BYTES: u64 = 512 * 1024;
const KEEP_RECENT_LINES: usize = 120;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityPhase {
    Started,
    Succeeded,
    NeedsSelection,
    Blocked,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentActivityEvent {
    pub id: String,
    pub timestamp: String,
    /// `"cli"` | `"mcp"` | `"gui"`
    pub actor: String,
    pub phase: ActivityPhase,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tab_hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_selector: Option<String>,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
}

impl AgentActivityEvent {
    pub fn new(
        actor: impl Into<String>,
        phase: ActivityPhase,
        action: impl Into<String>,
        tab_hint: Option<&str>,
        target_selector: Option<&str>,
        summary: impl Into<String>,
        payload: Option<Value>,
    ) -> Self {
        let now = Local::now();
        let seq = EVENT_SEQ.fetch_add(1, Ordering::Relaxed);
        Self {
            id: format!("{}-{}-{}", now.timestamp_millis(), std::process::id(), seq),
            timestamp: now.format("%H:%M:%S").to_string(),
            actor: actor.into(),
            phase,
            action: action.into(),
            tab_hint: tab_hint.map(|s| s.to_string()),
            target_selector: target_selector.map(|s| s.to_string()),
            summary: summary.into(),
            payload,
        }
    }
}

pub fn activity_log_path(data_dir: &Path) -> PathBuf {
    data_dir.join(ACTIVITY_FILE_NAME)
}

/// Resolves the canonical shared `Data/` directory across CLI (`Release/`, `target/debug/`, `target/release/`)
/// and Desktop GUI so both processes always read/write the exact same state & activity stream.
pub fn resolve_default_data_dir() -> PathBuf {
    if let Ok(env_dir) = std::env::var("PBZ_AMM_DATA_DIR")
        && !env_dir.trim().is_empty()
    {
        return PathBuf::from(env_dir);
    }

    if let Ok(exe) = std::env::current_exe()
        && let Some(exe_dir) = exe.parent()
    {
        // Check up to 3 ancestor levels for our workspace root (`Cargo.toml` + `crates/pbz-amm-core`)
        let mut cursor = Some(exe_dir);
        for _ in 0..=3 {
            if let Some(dir) = cursor {
                if dir.join("Cargo.toml").is_file() && dir.join("crates").join("pbz-amm-core").is_dir() {
                    return dir.join("Data");
                }
                cursor = dir.parent();
            }
        }
        // Check if portable `<exe_dir>/Data` is writable; if installed under read-only Program Files,
        // fall back cleanly to `%LOCALAPPDATA%\PBZ-AMM\Data`.
        let portable_data = exe_dir.join("Data");
        if is_dir_writable_or_creatable(&portable_data) {
            return portable_data;
        }
        if let Ok(local_app) = std::env::var("LOCALAPPDATA")
            && !local_app.trim().is_empty()
        {
            return PathBuf::from(local_app).join("PBZ-AMM").join("Data");
        }
        return portable_data;
    }

    PathBuf::from("Data")
}

fn is_dir_writable_or_creatable(dir: &Path) -> bool {
    if fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(format!(".write_probe_{}", std::process::id()));
    match fs::OpenOptions::new().write(true).create_new(true).open(&probe) {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// Finds the best sibling `pbz-amm.exe` path for MCP snippets & `nxm://` registration.
pub fn resolve_sibling_cli_exe() -> PathBuf {
    if let Ok(exe) = std::env::current_exe()
        && let Some(dir) = exe.parent()
    {
        let same_dir = dir.join("pbz-amm.exe");
        if same_dir.is_file() {
            return same_dir;
        }
        let mut cursor = Some(dir);
        for _ in 0..=3 {
            if let Some(anc) = cursor {
                for rel in [
                    "Release/pbz-amm.exe",
                    "target/release/pbz-amm.exe",
                    "target/debug/pbz-amm.exe",
                ] {
                    let cand = anc.join(rel);
                    if cand.is_file() {
                        return cand;
                    }
                }
                cursor = anc.parent();
            }
        }
    }
    PathBuf::from("pbz-amm.exe")
}

/// Best-effort non-blocking append to `<Data>/activity.jsonl`. Never fails the caller command.
pub fn emit_activity(data_dir: &Path, event: &AgentActivityEvent) {
    let _ = (|| -> std::io::Result<()> {
        fs::create_dir_all(data_dir)?;
        let path = activity_log_path(data_dir);

        if let Ok(meta) = fs::metadata(&path)
            && meta.len() > MAX_ACTIVITY_BYTES
            && let Ok(file) = fs::File::open(&path)
        {
            let lines: Vec<String> = BufReader::new(file)
                .lines()
                .map_while(Result::ok)
                .filter(|l| !l.trim().is_empty())
                .collect();
            let start = lines.len().saturating_sub(KEEP_RECENT_LINES);
            let mut body = lines[start..].join("\n");
            if !body.is_empty() {
                body.push('\n');
            }
            let _ = fs::write(&path, body);
        }

        let serialized = serde_json::to_string(event)?;
        let mut f = OpenOptions::new().create(true).append(true).open(&path)?;
        writeln!(f, "{serialized}")?;
        f.flush()
    })();
}

pub fn read_recent_activity(data_dir: &Path, limit: usize) -> Vec<AgentActivityEvent> {
    let path = activity_log_path(data_dir);
    let Ok(file) = fs::File::open(path) else {
        return Vec::new();
    };
    let parsed: Vec<AgentActivityEvent> = BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str::<AgentActivityEvent>(&line).ok())
        .collect();
    let start = parsed.len().saturating_sub(limit);
    parsed[start..].to_vec()
}
