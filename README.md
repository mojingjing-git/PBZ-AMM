# PBZ-AMM

`PBZ-AMM` (Auto Mod Manager) is a mod manager for *Phantom Blade Zero* on Windows. It provides a standalone CLI (`pbz-amm`), an embedded stdio MCP server, and a Tauri desktop application backed by the same Rust core and local data directory.

[中文文档](README.zh-CN.md)

## Why

*Phantom Blade Zero* splits its launcher and shipping binary across `platform/<store>/PBZ.exe` (Steam, WeGame, Epic) and runs UE 5.7 IoStore containers alongside multiple script loaders (`UE4SS`, `PBZModLoader`, `Mods Menu`). Archives distributed on Nexus Mods often hardcode `platform/steam/`, bundle multiple mutually exclusive variants, or modify overlapping `.pak`/`.utoc` assets.

`PBZ-AMM` handles store path normalization, read-only container conflict indexing, staged hardlink deployment, and profile switching without overwriting unmanaged files in the game directory.

## Features

- **Game and framework detection**: Locates Steam (AppID `4115450`), WeGame, Epic, or custom installations and detects `UE4SS`, `Mods Menu`, `PBZModLoader`, `CPP Pak Bypass`, and `PBZ Outfit Framework`.
- **Archive inspection before deployment**: Unpacks `.zip`, `.7z`, `.rar` (via Windows `tar.exe` or `7z`), `.pak`, and directories with path-traversal and symlink checks. Rewrites hardcoded store prefixes (`platform/steam/` -> active store) and pauses when an archive contains mutually exclusive variants, duplicate script-loader builds, or unknown DLLs.
- **Read-only `.pak` and `.utoc` conflict detection**: Reads `.pak` indices and UE5 IoStore `DirectoryIndex` entries / `FIoChunkId` hashes directly without extracting full container payloads.
- **Staged hardlink deployment and profiles**: Stores mod versions under `Data/vault/`, hardlinks files into the game directory on the same volume (falling back to copy across volumes), preserves user-edited configuration files across updates, keeps one previous version for rollback, and supports switching between `vanilla` and custom profiles.
- **Save snapshots**: Backs up `ProjectPBZ/Saved/SaveGames` before profile switches, adoption of existing mods, or script/plugin installs; enforces closed-game checks and explicit confirmation on restore.
- **Nexus Mods integration**: Searches mods and checks updates via Nexus GraphQL v2 (no API key required). Stores Personal API Keys in Windows Credential Manager. Supports direct downloads for Premium accounts and browser-assisted `nxm://` / Windows `Downloads` capture for free accounts.
- **Shared CLI, MCP, and GUI**: CLI and MCP commands emit state updates so an open desktop window reflects changes in real time. The desktop UI supports both dark and light (rice-paper) themes.

## Usage

### Desktop GUI

Download the latest archive from [Releases](https://github.com/mojingjing-git/PBZ-AMM/releases) and extract it to a writable directory, then launch `pbz-amm-desktop.exe`.

### CLI

All subcommands accept `--json` for machine-readable output, `--game-dir <PATH>`, and `--data-dir <PATH>`.

```powershell
# Inspect detected game paths, frameworks, active profile, and unmanaged files
pbz-amm status

# Scan or adopt mods installed manually before using PBZ-AMM
pbz-amm adopt
pbz-amm adopt all

# Inspect an archive without modifying the game directory
pbz-amm inspect "D:\Mods\example.zip"

# Install an archive (pauses with exit code 10 if variant/conflict confirmation is needed)
pbz-amm install "D:\Mods\example.zip"
pbz-amm install "D:\Mods\example.zip" --select "VariantA"

# Enable, disable, roll back, or remove a managed mod
pbz-amm enable <mod_id>
pbz-amm disable <mod_id>
pbz-amm rollback <mod_id>
pbz-amm remove <mod_id>

# Switch profiles (game saves are shared across profiles)
pbz-amm profile switch vanilla
pbz-amm profile switch default

# Save backups
pbz-amm backup create --note "before-boss" --pin
pbz-amm backup restore <backup_id> --confirm

# Nexus Mods
pbz-amm nexus search "QTE"
pbz-amm nexus check-updates
pbz-amm nexus auth --set-key <API_KEY> --register-nxm

# Start the stdio MCP server
pbz-amm mcp serve
```

#### CLI exit codes

| Code | Status | Meaning |
| --- | --- | --- |
| `0` | `ok` | Completed |
| `10` | `needs_selection` | Requires variant choice, conflict override, or `--confirm` |
| `20` | `blocked` | Blocked by runtime state (game running, state lock, or awaiting browser download) |
| `1` | `error` | Operation failed |

## Limitations

- **Windows only**: Targets the Windows PC release and uses Windows Credential Manager, `HKCU` registry `nxm://` registration, and NTFS hardlinks.
- **Unpacked / unencrypted containers**: Encrypted `.pak`/`.utoc` files report container metadata and flag encryption rather than listing internal asset paths.
- **Save compatibility**: Switching to `vanilla` reverts managed mod files on disk, not state already written into a save file by gameplay-altering mods. Use save snapshots when testing such mods.

## Building from Source

Prerequisites:

- Windows 10 or 11 (x64) with WebView2 Runtime
- Rust `>= 1.89` (MSVC toolchain)
- Node.js `>= 20` and `pnpm >= 9`

```powershell
cd apps/pbz-amm-desktop
pnpm install --frozen-lockfile
pnpm build
cd ../..

cargo test --workspace
cargo build --release --workspace
```

Binaries are written to `target/release/pbz-amm.exe` and `target/release/pbz-amm-desktop.exe`.

## Repository Layout

- `crates/pbz-amm-core`: Core library (game locator, archive scanner, container index reader, deployment state machine, save backups, Nexus client, activity stream).
- `crates/pbz-amm-cli`: `pbz-amm` CLI and stdio MCP server.
- `apps/pbz-amm-desktop`: Tauri v2 + React 19 desktop frontend and Rust command bridge.
- `skills/pbz-amm`: Agent skill instructions for CLI/MCP orchestration.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
