# Contributing to PBZ-AMM

Thank you for helping improve `PBZ-AMM`!

## Development Prerequisites

- Windows 10 / 11 (x64) with WebView2 Runtime
- Rust `>= 1.89` (MSVC toolchain + `clippy`)
- Node.js `>= 20` and `pnpm >= 9`

## Local Verification Checklist

Before opening a Pull Request, please run:

```powershell
cd apps/pbz-amm-desktop
pnpm install --frozen-lockfile
pnpm build
cd ../..

cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

## Architecture Notes

- `crates/pbz-amm-core`: Single source of truth for game discovery, archive inspection/Zip-Slip guards, `.pak`/`.utoc` conflict detection, staging/hardlink deployment, save snapshots, and Nexus Mods integration.
- `crates/pbz-amm-cli`: Standalone CLI (`--json`) + stdio MCP server (`pbz-amm mcp serve`).
- `apps/pbz-amm-desktop`: Tauri v2 + React 19 desktop GUI sharing `pbz-amm-core` and the local `Data/` store.

## License

By contributing, you agree that your contributions will be licensed under the **Apache License 2.0**.
