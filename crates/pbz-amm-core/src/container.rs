// Copyright 2026 PBZ-AMM Contributors
// SPDX-License-Identifier: Apache-2.0

//! Header-only virtual asset & chunk inspector for Unreal Engine `.pak` and `.utoc` (IoStore) containers.
//! Reads only container metadata/TOC headers in milliseconds without decompressing multi-GB asset payloads.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;

const UTOC_MAGIC: &[u8; 16] = b"-==--==--==--==-";
const CONTAINER_FLAG_ENCRYPTED: u8 = 1 << 1;
const CONTAINER_FLAG_SIGNED: u8 = 1 << 2;
const CONTAINER_FLAG_INDEXED: u8 = 1 << 3;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ContainerIndex {
    pub container_name: String,
    pub format: String,
    pub encrypted: bool,
    pub mount_point: Option<String>,
    /// Normalized virtual asset paths (e.g. `content/characters/soul/mesh/sk_soul.uasset`).
    pub asset_paths: Vec<String>,
    /// 12-byte UE5 IoStore FIoChunkId hex fingerprints (catches collisions even when directory strings are stripped).
    pub chunk_ids: Vec<String>,
    pub notes: Vec<String>,
}

/// Inspect either a `.pak` or `.utoc` file header/index safely.
pub fn inspect_container(path: &Path) -> ContainerIndex {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let container_name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_string();

    match ext.as_str() {
        "pak" => inspect_pak(path, container_name),
        "utoc" => inspect_utoc(path, container_name),
        _ => ContainerIndex {
            container_name,
            format: ext,
            ..Default::default()
        },
    }
}

fn inspect_pak(path: &Path, container_name: String) -> ContainerIndex {
    let file = match File::open(path) {
        Ok(f) => f,
        Err(e) => {
            return ContainerIndex {
                container_name,
                format: "pak".to_string(),
                notes: vec![format!("无法打开 Pak 文件: {e}")],
                ..Default::default()
            };
        }
    };
    let mut reader = BufReader::new(file);
    match repak::PakBuilder::new().reader(&mut reader) {
        Ok(pak) => {
            let mount = pak.mount_point().to_string();
            let mut asset_paths: Vec<String> = pak
                .files()
                .into_iter()
                .map(|entry| normalize_virtual_path(&mount, &entry))
                .collect();
            asset_paths.sort();
            asset_paths.dedup();

            ContainerIndex {
                container_name,
                format: format!("pak_v{}", pak.version() as u8),
                encrypted: pak.encrypted_index(),
                mount_point: Some(mount),
                asset_paths,
                chunk_ids: Vec::new(),
                notes: Vec::new(),
            }
        }
        Err(err) => {
            let msg = err.to_string();
            let encrypted = msg.to_ascii_lowercase().contains("encrypt");
            ContainerIndex {
                container_name,
                format: "pak".to_string(),
                encrypted,
                mount_point: None,
                asset_paths: Vec::new(),
                chunk_ids: Vec::new(),
                notes: vec![format!("Pak 索引未解析（可能加密或为空容器）: {msg}")],
            }
        }
    }
}

/// Clean-room UE5 IoStore `.utoc` (`FIoStoreTocHeader` + `FIoChunkId` table + unencrypted `FIoDirectoryIndexResource`) reader.
fn inspect_utoc(path: &Path, container_name: String) -> ContainerIndex {
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(e) => {
            return ContainerIndex {
                container_name,
                format: "utoc".to_string(),
                notes: vec![format!("无法打开 utoc 文件: {e}")],
                ..Default::default()
            };
        }
    };

    let mut header = [0u8; 144];
    if let Err(e) = file.read_exact(&mut header) {
        return ContainerIndex {
            container_name,
            format: "utoc".to_string(),
            notes: vec![format!("utoc 头部长度不足 144 字节: {e}")],
            ..Default::default()
        };
    }

    if &header[0..16] != UTOC_MAGIC {
        return ContainerIndex {
            container_name,
            format: "utoc".to_string(),
            notes: vec!["非标准 UE5 IoStore .utoc 魔数".to_string()],
            ..Default::default()
        };
    }

    let version = header[16];
    let header_size = u32::from_le_bytes(header[20..24].try_into().unwrap());
    let toc_entry_count = u32::from_le_bytes(header[24..28].try_into().unwrap());
    let compressed_block_count = u32::from_le_bytes(header[28..32].try_into().unwrap());
    let compression_block_entry_size = u32::from_le_bytes(header[32..36].try_into().unwrap());
    let compression_method_name_count = u32::from_le_bytes(header[36..40].try_into().unwrap());
    let compression_method_name_len = u32::from_le_bytes(header[40..44].try_into().unwrap());
    let directory_index_size = u32::from_le_bytes(header[48..52].try_into().unwrap());
    let partition_count = u32::from_le_bytes(header[52..56].try_into().unwrap());
    let container_flags = header[80];
    let toc_chunk_perfect_hash_seeds_count =
        u32::from_le_bytes(header[84..88].try_into().unwrap());
    let toc_chunks_without_perfect_hash_count =
        u32::from_le_bytes(header[96..100].try_into().unwrap());

    let encrypted = (container_flags & CONTAINER_FLAG_ENCRYPTED) != 0;
    let signed = (container_flags & CONTAINER_FLAG_SIGNED) != 0;
    let indexed = (container_flags & CONTAINER_FLAG_INDEXED) != 0;

    let mut notes = Vec::new();
    let mut chunk_ids = Vec::new();
    let mut asset_paths = Vec::new();
    let mut mount_point = None;

    if header_size < 144 || toc_entry_count > 2_000_000 {
        notes.push(format!(
            "utoc 头部参数超出预期范围 (header_size={header_size}, entries={toc_entry_count})"
        ));
        return ContainerIndex {
            container_name,
            format: format!("utoc_v{version}"),
            encrypted,
            mount_point,
            asset_paths,
            chunk_ids,
            notes,
        };
    }

    if file.seek(SeekFrom::Start(u64::from(header_size))).is_ok() {
        let mut raw_ids = vec![0u8; (toc_entry_count as usize) * 12];
        if file.read_exact(&mut raw_ids).is_ok() {
            for chunk in raw_ids.as_chunks::<12>().0 {
                // Chunk type byte is chunk[11]; skip ContainerHeader meta chunk (type 10 in UE5) if desired,
                // or keep all non-zero asset chunks for exact collision matching.
                if chunk.iter().any(|&b| b != 0) {
                    chunk_ids.push(hex::encode(chunk));
                }
            }
            chunk_ids.sort();
            chunk_ids.dedup();
        }

        // Compute offset to DirectoryIndex when unencrypted and untampered/unsigned (or skip signature table)
        if !encrypted && indexed && directory_index_size > 0 && directory_index_size <= 64 * 1024 * 1024 {
            let offsets_len = u64::from(toc_entry_count) * 10;
            let perfect_hash_len = if version >= 3 {
                u64::from(toc_chunk_perfect_hash_seeds_count) * 4
                    + u64::from(toc_chunks_without_perfect_hash_count) * 4
            } else {
                0
            };
            let comp_blocks_len =
                u64::from(compressed_block_count) * u64::from(compression_block_entry_size.max(12));
            let comp_methods_len =
                u64::from(compression_method_name_count) * u64::from(compression_method_name_len);

            let sig_skip_ok = if signed {
                // Signed containers store: i32 hash_size + toc_sig[hash_size] + block_sig[hash_size] + compressed_block_count * 20 bytes SHA1
                let pre_sig_pos = u64::from(header_size)
                    + (u64::from(toc_entry_count) * 12)
                    + offsets_len
                    + perfect_hash_len
                    + comp_blocks_len
                    + comp_methods_len;
                if file.seek(SeekFrom::Start(pre_sig_pos)).is_ok() {
                    let mut sz_buf = [0u8; 4];
                    if file.read_exact(&mut sz_buf).is_ok() {
                        let sig_len = u32::from_le_bytes(sz_buf) as u64;
                        let total_sig = 4 + sig_len * 2 + u64::from(compressed_block_count) * 20;
                        Some(pre_sig_pos + total_sig)
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                Some(
                    u64::from(header_size)
                        + (u64::from(toc_entry_count) * 12)
                        + offsets_len
                        + perfect_hash_len
                        + comp_blocks_len
                        + comp_methods_len,
                )
            };

            if let Some(dir_offset) = sig_skip_ok
                && file.seek(SeekFrom::Start(dir_offset)).is_ok()
            {
                let mut dir_buf = vec![0u8; directory_index_size as usize];
                if file.read_exact(&mut dir_buf).is_ok() {
                    let _ = partition_count;
                    if let Some((mp, paths)) = parse_io_directory_index(&dir_buf) {
                        mount_point = Some(mp);
                        asset_paths = paths;
                    }
                }
            }
        } else if encrypted {
            notes.push("IoStore 目录索引已加密，已使用未加密的 FIoChunkId 块指纹做冲突检测".to_string());
        }
    }

    ContainerIndex {
        container_name,
        format: format!("utoc_v{version}"),
        encrypted,
        mount_point,
        asset_paths,
        chunk_ids,
        notes,
    }
}

/// Parses UE5 `FIoDirectoryIndexResource`:
/// - FString MountPoint
/// - TArray<FIoDirectoryIndexEntry> DirectoryEntries (Name: u32, FirstChild: u32, NextSibling: u32, FirstFile: u32)
/// - TArray<FIoFileIndexEntry> FileEntries (Name: u32, NextFile: u32, UserData: u32)
/// - TArray<FString> StringTable
fn parse_io_directory_index(buf: &[u8]) -> Option<(String, Vec<String>)> {
    let mut cur = 0usize;
    let mount_point = read_fstring(buf, &mut cur)?;

    let dir_count = read_u32(buf, &mut cur)? as usize;
    if dir_count > 1_000_000 || cur.checked_add(dir_count * 16)? > buf.len() {
        return None;
    }
    let mut dirs = Vec::with_capacity(dir_count);
    for _ in 0..dir_count {
        let name = read_u32(buf, &mut cur)?;
        let first_child = read_u32(buf, &mut cur)?;
        let next_sibling = read_u32(buf, &mut cur)?;
        let first_file = read_u32(buf, &mut cur)?;
        dirs.push((name, first_child, next_sibling, first_file));
    }

    let file_count = read_u32(buf, &mut cur)? as usize;
    if file_count > 2_000_000 || cur.checked_add(file_count * 12)? > buf.len() {
        return None;
    }
    let mut files = Vec::with_capacity(file_count);
    for _ in 0..file_count {
        let name = read_u32(buf, &mut cur)?;
        let next_file = read_u32(buf, &mut cur)?;
        let _user_data = read_u32(buf, &mut cur)?;
        files.push((name, next_file));
    }

    let str_count = read_u32(buf, &mut cur)? as usize;
    if str_count > 3_000_000 {
        return None;
    }
    let mut strings = Vec::with_capacity(str_count.min(65536));
    for _ in 0..str_count {
        strings.push(read_fstring(buf, &mut cur)?);
    }

    let mut results = Vec::new();
    if !dirs.is_empty() {
        let mut stack: Vec<(usize, String)> = vec![(0, String::new())];
        let mut visited = 0usize;
        while let Some((idx, prefix)) = stack.pop() {
            visited += 1;
            if idx >= dirs.len() || visited > dirs.len() * 2 {
                break;
            }
            let (name_idx, first_child, next_sibling, first_file) = dirs[idx];
            if next_sibling != u32::MAX {
                stack.push((next_sibling as usize, prefix.clone()));
            }
            let current_dir = if name_idx == u32::MAX {
                prefix
            } else {
                let seg = strings.get(name_idx as usize)?.as_str();
                if prefix.is_empty() {
                    seg.to_string()
                } else {
                    format!("{prefix}/{seg}")
                }
            };

            let mut f_idx = first_file;
            let mut f_guard = 0usize;
            while f_idx != u32::MAX && (f_idx as usize) < files.len() && f_guard <= files.len() {
                f_guard += 1;
                let (f_name_idx, next_f) = files[f_idx as usize];
                if let Some(fname) = strings.get(f_name_idx as usize) {
                    let rel = if current_dir.is_empty() {
                        fname.clone()
                    } else {
                        format!("{current_dir}/{fname}")
                    };
                    results.push(normalize_virtual_path(&mount_point, &rel));
                }
                f_idx = next_f;
            }

            if first_child != u32::MAX {
                stack.push((first_child as usize, current_dir));
            }
        }
    }

    results.sort();
    results.dedup();
    Some((mount_point, results))
}

fn read_u32(buf: &[u8], cur: &mut usize) -> Option<u32> {
    let end = cur.checked_add(4)?;
    let bytes: [u8; 4] = buf.get(*cur..end)?.try_into().ok()?;
    *cur = end;
    Some(u32::from_le_bytes(bytes))
}

fn read_fstring(buf: &[u8], cur: &mut usize) -> Option<String> {
    let len_i32 = read_u32(buf, cur)? as i32;
    if len_i32 == 0 {
        return Some(String::new());
    }
    if len_i32 > 0 {
        let byte_len = len_i32 as usize;
        if byte_len > 65536 {
            return None;
        }
        let end = cur.checked_add(byte_len)?;
        let slice = buf.get(*cur..end)?;
        *cur = end;
        let trimmed = slice.strip_suffix(&[0]).unwrap_or(slice);
        Some(String::from_utf8_lossy(trimmed).into_owned())
    } else {
        let char_count = (-len_i32) as usize;
        let byte_len = char_count.checked_mul(2)?;
        if byte_len > 131072 {
            return None;
        }
        let end = cur.checked_add(byte_len)?;
        let slice = buf.get(*cur..end)?;
        *cur = end;
        let mut units: Vec<u16> = slice
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        if units.last() == Some(&0) {
            units.pop();
        }
        Some(String::from_utf16_lossy(&units))
    }
}

pub fn normalize_virtual_path(mount_point: &str, entry: &str) -> String {
    let combined = format!(
        "{}/{}",
        mount_point.replace('\\', "/"),
        entry.replace('\\', "/")
    );
    let mut stack: Vec<&str> = Vec::new();
    for part in combined.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                stack.pop();
            }
            seg => stack.push(seg),
        }
    }
    stack.join("/").to_ascii_lowercase()
}

/// Asset-level or chunk-level overlap report between two mods.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetConflict {
    pub mod_a: String,
    pub mod_b: String,
    pub overlapping_assets: Vec<String>,
    pub overlapping_chunks: usize,
}

/// Compare indexed containers across multiple mods and find exact asset/chunk overlaps.
pub fn find_container_conflicts(
    mod_containers: &[(String, Vec<ContainerIndex>)],
) -> Vec<AssetConflict> {
    let mut mod_paths: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut mod_chunks: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();

    for (mod_id, indices) in mod_containers {
        let p_set = mod_paths.entry(mod_id.clone()).or_default();
        let c_set = mod_chunks.entry(mod_id.clone()).or_default();
        for idx in indices {
            for p in &idx.asset_paths {
                p_set.insert(p.clone());
            }
            for c in &idx.chunk_ids {
                c_set.insert(c.clone());
            }
        }
    }

    let mod_ids: Vec<String> = mod_paths.keys().cloned().collect();
    let mut conflicts = Vec::new();
    for i in 0..mod_ids.len() {
        for j in (i + 1)..mod_ids.len() {
            let a = &mod_ids[i];
            let b = &mod_ids[j];
            let overlapping_assets: Vec<String> = mod_paths[a]
                .intersection(&mod_paths[b])
                .take(50)
                .cloned()
                .collect();
            let overlapping_chunks = mod_chunks[a].intersection(&mod_chunks[b]).count();
            if !overlapping_assets.is_empty() || overlapping_chunks > 0 {
                conflicts.push(AssetConflict {
                    mod_a: a.clone(),
                    mod_b: b.clone(),
                    overlapping_assets,
                    overlapping_chunks,
                });
            }
        }
    }
    conflicts
}
