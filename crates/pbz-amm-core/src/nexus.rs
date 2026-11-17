// Copyright 2026 PBZ-AMM Contributors
// SPDX-License-Identifier: Apache-2.0

//! Verified Nexus Mods integration for Phantom Blade Zero (`gameId = 10614`, `domain = "phantombladezero"`):
//! - Public GraphQL v2 (`https://api.nexusmods.com/v2/graphql`) for keyword search, mod details, requirements, and batch update checks (no API key required).
//! - Official REST v1 (`https://api.nexusmods.com/v1`) + Windows Credential Manager (`keyring`) for account validation and file downloads.
//! - Automatic Premium silent download vs Free-account `nxm://` browser confirmation protocol (`HKCU\Software\Classes\nxm`).

use crate::error::{AmmError, Result};
use crate::game::{PBZ_NEXUS_DOMAIN, PBZ_NEXUS_GAME_ID};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io;
use std::path::Path;
use winreg::RegKey;
use winreg::enums::HKEY_CURRENT_USER;

const NEXUS_GRAPHQL_V2_URL: &str = "https://api.nexusmods.com/v2/graphql";
const NEXUS_REST_V1_BASE: &str = "https://api.nexusmods.com/v1";
const KEYRING_SERVICE: &str = "PBZ-AMM.NexusMods";
const KEYRING_USER: &str = "api_key";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NexusModSummary {
    pub mod_id: u32,
    pub name: String,
    pub summary: String,
    pub version: String,
    pub author: String,
    pub downloads: u64,
    pub category: Option<String>,
    pub page_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NexusRequirement {
    pub mod_id: u32,
    pub name: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NexusModDetails {
    pub summary: NexusModSummary,
    pub requirements: Vec<NexusRequirement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NexusUserStatus {
    pub user_id: u64,
    pub name: String,
    pub is_premium: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NexusFileEntry {
    pub file_id: u64,
    pub name: String,
    pub version: String,
    pub file_name: String,
    pub category_name: Option<String>,
    pub size_in_bytes: Option<u64>,
    pub is_primary: bool,
}

/// Parsed `nxm://phantombladezero/mods/<mod_id>/files/<file_id>?key=<key>&expires=<ts>` URI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NxmUri {
    pub domain: String,
    pub mod_id: u32,
    pub file_id: u64,
    pub key: Option<String>,
    pub expires: Option<String>,
}

impl NxmUri {
    pub fn parse(raw: &str) -> Result<Self> {
        let trimmed = raw.trim();
        let rest = trimmed
            .strip_prefix("nxm://")
            .ok_or_else(|| AmmError::InvalidNxmUri(raw.to_string()))?;
        let (path_part, query_part) = match rest.split_once('?') {
            Some((p, q)) => (p, Some(q)),
            None => (rest, None),
        };
        let segs: Vec<&str> = path_part.split('/').filter(|s| !s.is_empty()).collect();
        if segs.len() < 5 || segs[1] != "mods" || segs[3] != "files" {
            return Err(AmmError::InvalidNxmUri(raw.to_string()));
        }
        let domain = segs[0].to_ascii_lowercase();
        if domain != PBZ_NEXUS_DOMAIN {
            return Err(AmmError::InvalidNxmUri(format!(
                "仅支持《影之刃零》({PBZ_NEXUS_DOMAIN}) 的 nxm:// 链接，收到: {domain}"
            )));
        }
        let mod_id: u32 = segs[2]
            .parse()
            .map_err(|_| AmmError::InvalidNxmUri(raw.to_string()))?;
        let file_id: u64 = segs[4]
            .parse()
            .map_err(|_| AmmError::InvalidNxmUri(raw.to_string()))?;

        let mut key = None;
        let mut expires = None;
        if let Some(q) = query_part {
            for kv in q.split('&') {
                if let Some((k, v)) = kv.split_once('=') {
                    match k {
                        "key" => key = Some(v.to_string()),
                        "expires" => expires = Some(v.to_string()),
                        _ => {}
                    }
                }
            }
        }

        Ok(Self {
            domain,
            mod_id,
            file_id,
            key,
            expires,
        })
    }
}

/// Save Nexus Personal API Key securely in Windows Credential Manager.
pub fn store_api_key(api_key: &str) -> Result<()> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| AmmError::Other(format!("访问 Windows 凭据管理器失败: {e}")))?;
    entry
        .set_password(api_key.trim())
        .map_err(|e| AmmError::Other(format!("写入 Windows 凭据管理器失败: {e}")))?;
    Ok(())
}

pub fn load_api_key() -> Result<String> {
    if let Ok(env_key) = std::env::var("PBZ_AMM_NEXUS_API_KEY")
        && !env_key.trim().is_empty()
    {
        return Ok(env_key.trim().to_string());
    }
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|_| AmmError::NexusAuthRequired)?;
    entry
        .get_password()
        .map_err(|_| AmmError::NexusAuthRequired)
}

pub fn clear_api_key() -> Result<()> {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        let _ = entry.delete_credential();
    }
    Ok(())
}

/// Register per-user `HKCU\Software\Classes\nxm` URL handler (zero Administrator UAC prompt needed).
pub fn register_nxm_protocol(cli_exe_path: &Path) -> Result<()> {
    if !cli_exe_path.is_file() {
        return Err(AmmError::Other(format!(
            "未找到 pbz-amm.exe ({}), 无法注册 nxm:// 协议",
            cli_exe_path.display()
        )));
    }
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (nxm_key, _) = hkcu.create_subkey(r"Software\Classes\nxm")?;
    nxm_key.set_value("", &"URL:Nexus Mod Manager Protocol (PBZ-AMM)")?;
    nxm_key.set_value("URL Protocol", &"")?;

    let (cmd_key, _) = nxm_key.create_subkey(r"shell\open\command")?;
    let command_str = format!("\"{}\" nexus handle-nxm \"%1\"", cli_exe_path.display());
    cmd_key.set_value("", &command_str)?;
    Ok(())
}

/// Check whether `HKCU\Software\Classes\nxm` is registered to an existing `pbz-amm` binary.
pub fn is_nxm_protocol_registered() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(cmd_key) = hkcu.open_subkey(r"Software\Classes\nxm\shell\open\command") else {
        return false;
    };
    let Ok(val) = cmd_key.get_value::<String, _>("") else {
        return false;
    };
    let lower = val.to_ascii_lowercase();
    if !lower.contains("pbz-amm") || !lower.contains("handle-nxm") {
        return false;
    }
    let exe_part = if let Some(rest) = val.trim_start().strip_prefix('"') {
        rest.split('"').next().unwrap_or("")
    } else {
        val.split_whitespace().next().unwrap_or("")
    };
    !exe_part.is_empty() && Path::new(exe_part).is_file()
}

/// Sanitize a remote Nexus `file_name` so it can never traverse outside `downloads/`.
pub fn safe_download_filename(raw: &str, mod_id: u32, file_id: u64) -> String {
    let leaf = raw
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .trim()
        .replace([':', '*', '?', '"', '<', '>', '|', '\0'], "_");
    if leaf.is_empty() || leaf == "." || leaf == ".." {
        format!("nexus-{mod_id}-{file_id}.zip")
    } else {
        leaf
    }
}

/// Resolve the current user's Windows Downloads directory (supports custom relocated folders).
pub fn resolve_windows_downloads_dir() -> Option<std::path::PathBuf> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(folders) =
        hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders")
        && let Ok(raw) = folders.get_value::<String, _>("{374DE290-123F-4565-9164-39C4925E467B}")
    {
        let mut expanded = raw;
        for var_name in ["USERPROFILE", "OneDrive", "OneDriveConsumer"] {
            if let Ok(val) = std::env::var(var_name) {
                let needle = format!("%{var_name}%");
                if let Some(idx) = expanded
                    .to_ascii_lowercase()
                    .find(&needle.to_ascii_lowercase())
                {
                    expanded.replace_range(idx..idx + needle.len(), &val);
                }
            }
        }
        let p = std::path::PathBuf::from(expanded);
        if p.is_dir() {
            return Some(p);
        }
    }
    std::env::var_os("USERPROFILE")
        .map(|u| std::path::PathBuf::from(u).join("Downloads"))
        .filter(|p| p.is_dir())
}

/// Search Phantom Blade Zero mods on Nexus Mods via official GraphQL v2 API (works without API key).
pub fn search_mods(keyword: Option<&str>, count: u32) -> Result<Vec<NexusModSummary>> {
    let capped = count.clamp(1, 50);
    let filter_clause = match keyword.map(str::trim).filter(|k| !k.is_empty()) {
        Some(kw) => {
            let escaped = kw.replace('\\', "\\\\").replace('"', "\\\"");
            format!(
                r#"{{ gameDomainName: {{ value: "{PBZ_NEXUS_DOMAIN}", op: EQUALS }}, name: {{ value: "{escaped}", op: WILDCARD }} }}"#
            )
        }
        None => format!(r#"{{ gameDomainName: {{ value: "{PBZ_NEXUS_DOMAIN}", op: EQUALS }} }}"#),
    };

    let query = format!(
        r#"query {{
            mods(filter: {filter_clause}, count: {capped}, sort: {{ downloads: {{ direction: DESC }} }}) {{
                nodes {{
                    modId
                    name
                    summary
                    version
                    author
                    downloads
                    modCategory {{ name }}
                }}
            }}
        }}"#
    );

    let payload = serde_json::json!({ "query": query });
    let resp: serde_json::Value = ureq::post(NEXUS_GRAPHQL_V2_URL)
        .header("User-Agent", "PBZ-AMM/0.1.0")
        .send_json(&payload)
        .map_err(|e| AmmError::Network(e.to_string()))?
        .body_mut()
        .read_json()
        .map_err(|e| AmmError::Network(e.to_string()))?;

    let nodes = resp
        .pointer("/data/mods/nodes")
        .and_then(|v| v.as_array())
        .ok_or_else(|| AmmError::Network("Nexus GraphQL v2 返回结构异常".to_string()))?;

    let mut out = Vec::with_capacity(nodes.len());
    for n in nodes {
        let mod_id = n.get("modId").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
        out.push(NexusModSummary {
            mod_id,
            name: n
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            summary: n
                .get("summary")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            version: n
                .get("version")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            author: n
                .get("author")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            downloads: n.get("downloads").and_then(|v| v.as_u64()).unwrap_or(0),
            category: n
                .pointer("/modCategory/name")
                .and_then(|v| v.as_str())
                .map(ToString::to_string),
            page_url: format!("https://www.nexusmods.com/{PBZ_NEXUS_DOMAIN}/mods/{mod_id}"),
        });
    }
    Ok(out)
}

/// Fetch details & prerequisite requirements for a single Nexus Mod ID via GraphQL v2.
pub fn fetch_mod_details(mod_id: u32) -> Result<NexusModDetails> {
    let query = format!(
        r#"query {{
            mod(gameId: {PBZ_NEXUS_GAME_ID}, modId: {mod_id}) {{
                modId
                name
                summary
                version
                author
                downloads
                modCategory {{ name }}
                modRequirements {{
                    nexusRequirements {{
                        nodes {{
                            modId
                            modName
                            notes
                        }}
                    }}
                }}
            }}
        }}"#
    );

    let payload = serde_json::json!({ "query": query });
    let resp: serde_json::Value = ureq::post(NEXUS_GRAPHQL_V2_URL)
        .header("User-Agent", "PBZ-AMM/0.1.0")
        .send_json(&payload)
        .map_err(|e| AmmError::Network(e.to_string()))?
        .body_mut()
        .read_json()
        .map_err(|e| AmmError::Network(e.to_string()))?;

    let m = resp
        .pointer("/data/mod")
        .filter(|v| !v.is_null())
        .ok_or_else(|| AmmError::ModNotFound(format!("Nexus #{mod_id}")))?;

    let summary = NexusModSummary {
        mod_id,
        name: m
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        summary: m
            .get("summary")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        version: m
            .get("version")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        author: m
            .get("author")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        downloads: m.get("downloads").and_then(|v| v.as_u64()).unwrap_or(0),
        category: m
            .pointer("/modCategory/name")
            .and_then(|v| v.as_str())
            .map(ToString::to_string),
        page_url: format!("https://www.nexusmods.com/{PBZ_NEXUS_DOMAIN}/mods/{mod_id}"),
    };

    let mut requirements = Vec::new();
    if let Some(req_nodes) = m
        .pointer("/modRequirements/nexusRequirements/nodes")
        .and_then(|v| v.as_array())
    {
        for r in req_nodes {
            if let Some(id_str_or_num) = r.get("modId") {
                let req_id = id_str_or_num
                    .as_u64()
                    .or_else(|| id_str_or_num.as_str()?.parse::<u64>().ok())
                    .unwrap_or(0) as u32;
                if req_id > 0 {
                    requirements.push(NexusRequirement {
                        mod_id: req_id,
                        name: r
                            .get("modName")
                            .and_then(|v| v.as_str())
                            .unwrap_or_default()
                            .to_string(),
                        notes: r
                            .get("notes")
                            .and_then(|v| v.as_str())
                            .filter(|s| !s.is_empty())
                            .map(ToString::to_string),
                    });
                }
            }
        }
    }

    Ok(NexusModDetails {
        summary,
        requirements,
    })
}

/// Validate configured Nexus API key and inspect `is_premium` status.
pub fn validate_account(api_key: &str) -> Result<NexusUserStatus> {
    let url = format!("{NEXUS_REST_V1_BASE}/users/validate.json");
    let resp: serde_json::Value = ureq::get(&url)
        .header("apikey", api_key)
        .header("User-Agent", "PBZ-AMM/0.1.0")
        .call()
        .map_err(|e| AmmError::Network(format!("Nexus 账号校验失败: {e}")))?
        .body_mut()
        .read_json()
        .map_err(|e| AmmError::Network(e.to_string()))?;

    Ok(NexusUserStatus {
        user_id: resp.get("user_id").and_then(|v| v.as_u64()).unwrap_or(0),
        name: resp
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        is_premium: resp
            .get("is_premium")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    })
}

/// List downloadable files for a mod via REST v1 (`Requires API key`).
pub fn list_mod_files(api_key: &str, mod_id: u32) -> Result<Vec<NexusFileEntry>> {
    let url = format!("{NEXUS_REST_V1_BASE}/games/{PBZ_NEXUS_DOMAIN}/mods/{mod_id}/files.json");
    let resp: serde_json::Value = ureq::get(&url)
        .header("apikey", api_key)
        .header("User-Agent", "PBZ-AMM/0.1.0")
        .call()
        .map_err(|e| AmmError::Network(e.to_string()))?
        .body_mut()
        .read_json()
        .map_err(|e| AmmError::Network(e.to_string()))?;

    let files = resp
        .get("files")
        .and_then(|v| v.as_array())
        .ok_or_else(|| AmmError::Network("Nexus files.json 格式异常".to_string()))?;

    let mut out = Vec::new();
    for f in files {
        let cat = f.get("category_name").and_then(|v| v.as_str());
        if cat == Some("OLD_VERSION") || cat == Some("ARCHIVED") {
            continue;
        }
        out.push(NexusFileEntry {
            file_id: f.get("file_id").and_then(|v| v.as_u64()).unwrap_or(0),
            name: f
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            version: f
                .get("version")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            file_name: f
                .get("file_name")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            category_name: cat.map(ToString::to_string),
            size_in_bytes: f.get("size_in_bytes").and_then(|v| v.as_u64()),
            is_primary: f
                .get("is_primary")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
        });
    }
    Ok(out)
}

/// Resolve download URL (Premium direct OR Free account with `key` & `expires` from `nxm://`) and stream to `dest_file`.
pub fn download_mod_file(
    api_key: &str,
    mod_id: u32,
    file_id: u64,
    nxm_key: Option<&str>,
    nxm_expires: Option<&str>,
    dest_file: &Path,
) -> Result<()> {
    let mut url = format!(
        "{NEXUS_REST_V1_BASE}/games/{PBZ_NEXUS_DOMAIN}/mods/{mod_id}/files/{file_id}/download_link.json"
    );
    if let (Some(k), Some(exp)) = (nxm_key, nxm_expires) {
        let valid_token = |s: &str| {
            !s.is_empty()
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        };
        if !valid_token(k) || !exp.bytes().all(|b| b.is_ascii_digit()) {
            return Err(AmmError::InvalidNxmUri(
                "nxm:// 下载令牌参数格式无效".to_string(),
            ));
        }
        url.push_str(&format!("?key={k}&expires={exp}"));
    } else {
        let account = validate_account(api_key)?;
        if !account.is_premium {
            let web_url = format!(
                "https://www.nexusmods.com/{PBZ_NEXUS_DOMAIN}/mods/{mod_id}?tab=files&file_id={file_id}&nmm=1"
            );
            let _ = std::process::Command::new("rundll32")
                .args(["url.dll,FileProtocolHandler", &web_url])
                .spawn();
            return Err(AmmError::NexusAwaitingBrowserConfirm { url: web_url });
        }
    }

    let links: serde_json::Value = ureq::get(&url)
        .header("apikey", api_key)
        .header("User-Agent", "PBZ-AMM/0.1.0")
        .call()
        .map_err(|e| AmmError::Network(format!("获取 Nexus 下载直链失败: {e}")))?
        .body_mut()
        .read_json()
        .map_err(|e| AmmError::Network(e.to_string()))?;

    let cdn_uri = links
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|item| item.get("URI"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| AmmError::Network("Nexus 未返回可用 CDN 下载地址".to_string()))?;

    if let Some(parent) = dest_file.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut resp = ureq::get(cdn_uri)
        .header("User-Agent", "PBZ-AMM/0.1.0")
        .call()
        .map_err(|e| AmmError::Network(format!("下载 Mod 文件失败: {e}")))?;

    let mut reader = resp.body_mut().as_reader();
    let mut out = File::create(dest_file)?;
    io::copy(&mut reader, &mut out)?;
    Ok(())
}
