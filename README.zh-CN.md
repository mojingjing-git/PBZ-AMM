# PBZ-AMM

`PBZ-AMM`（Auto Mod Manager）是面向 Windows 平台《影之刃零》（*Phantom Blade Zero*）的开源 Mod 管理器，提供独立命令行工具（`pbz-amm`）、本地 stdio MCP 服务以及 Tauri 桌面端界面，三者共用同一套 Rust 核心引擎与本地数据目录。

[English](README.md)

## 设计背景

《影之刃零》PC 版将启动壳与主程序拆分在 `platform/<store>/PBZ.exe`（Steam / WeGame / Epic），同时存在 UE 5.7 IoStore 容器（`.pak` / `.utoc` / `.ucas`）与多个脚本加载器（`UE4SS`、`PBZModLoader`、`Mods Menu`）。社区分发的压缩包经常写死 `platform/steam/` 路径、内含多选一变体，或修改了相同的容器内部资产。

`PBZ-AMM` 负责处理商店路径重定向、只读容器冲突预检、独立暂存硬链接部署以及多配置切换，且不会删除非本工具接管的既有文件。

## 功能

- **游戏与框架识别**：自动定位 Steam（AppID `4115450`）、WeGame、Epic 或手动指定目录，检测 `UE4SS`、`Mods Menu`、`PBZModLoader`、`CPP Pak Bypass` 与 `PBZ Outfit Framework` 及代理 DLL 占用情况。
- **安装前安全预检**：支持 `.zip`、`.7z`、`.rar`（调用 Windows `tar.exe` 或 `7z`）、`.pak` 及解压目录，执行路径穿越与符号链接校验；自动将写死的商店子路径改写为当前平台目录；遇到多选一变体、双脚本加载器副本或未识别 DLL 时暂停并提示确认。
- **`.pak` / `.utoc` 内部资产冲突检测**：只读解析 `.pak` 索引表及 UE5 IoStore `.utoc` 的 `DirectoryIndex` 与 `FIoChunkId`，在不解包完整资源的前提下识别内部资产重叠。
- **暂存仓库与配置切换**：所有受管文件先写入 `Data/vault/`，同卷通过硬链接部署（跨卷回退为复制）；更新 Mod 时保留玩家修改过的配置文件并留存上一版本用于回滚；支持在 `vanilla`（纯净原版）与自定义配置方案之间切换。
- **存档快照**：在切换配置、接管已有 Mod 或安装脚本/插件类 Mod 前自动备份 `ProjectPBZ/Saved/SaveGames`；恢复操作校验游戏已关闭且要求显式确认。
- **Nexus Mods 集成**：通过官方 GraphQL v2 免密钥搜索 Mod 与检查更新；API Key 加密存放在 Windows 凭据管理器中；会员支持直连下载，免费账号支持 `nxm://` 回调及自动监听 Windows 下载目录接管（亦可选用内置 WebView2 小窗）。
- **CLI / MCP / GUI 联动**：命令行与 MCP 执行状态会写入本地事件流，已打开的桌面端窗口可实时同步页面状态与预检弹窗。桌面端提供「夜雨暗」与「宣纸浅」两套主题。

## 使用说明

### 桌面端

从 [Releases](https://github.com/mojingjing-git/PBZ-AMM/releases) 下载压缩包并解压至可写目录，运行 `pbz-amm-desktop.exe`。

### 命令行

所有子命令均支持 `--json`、`--game-dir <路径>` 与 `--data-dir <路径>` 全局参数。

```powershell
# 查看游戏目录、前置框架、当前配置与未接管文件
pbz-amm status

# 扫描或接管此前手动安装的 Mod
pbz-amm adopt
pbz-amm adopt all

# 预检压缩包（不改动游戏目录）
pbz-amm inspect "D:\Mods\example.zip"

# 安装 Mod（遇到多变体、冲突或未知 DLL 时返回退出码 10 暂停待选）
pbz-amm install "D:\Mods\example.zip"
pbz-amm install "D:\Mods\example.zip" --select "VariantA"

# 启用、停用、回滚或卸载
pbz-amm enable <mod_id>
pbz-amm disable <mod_id>
pbz-amm rollback <mod_id>
pbz-amm remove <mod_id>

# 切换配置方案（游戏存档始终共用）
pbz-amm profile switch vanilla
pbz-amm profile switch default

# 存档备份与恢复
pbz-amm backup create --note "before-boss" --pin
pbz-amm backup restore <backup_id> --confirm

# Nexus Mods 操作
pbz-amm nexus search "QTE"
pbz-amm nexus check-updates
pbz-amm nexus auth --set-key <API_KEY> --register-nxm

# 启动 stdio MCP 服务
pbz-amm mcp serve
```

#### CLI 退出码

| 退出码 | 状态 | 含义 |
| --- | --- | --- |
| `0` | `ok` | 执行成功 |
| `10` | `needs_selection` | 需要选择变体、确认覆盖冲突或传入 `--confirm` |
| `20` | `blocked` | 被外部状态阻塞（游戏运行中、数据目录锁占用或等待浏览器下载确认） |
| `1` | `error` | 执行失败 |

## 已知限制

- **仅支持 Windows**：依赖 Windows 凭据管理器、`HKCU` 注册表 `nxm://` 协议以及 NTFS 硬链接。
- **加密容器**：加密的 `.pak`/`.utoc` 仅提示加密状态，无法枚举内部资产路径。
- **存档兼容性**：切回 `vanilla` 仅撤销由本工具部署的文件，无法回退已写入存档文件本身的模组数据；高风险修改请配合存档快照使用。

## 从源码构建

环境要求：

- Windows 10 / 11（64 位，系统需已安装 WebView2 Runtime）
- Rust `>= 1.89`（MSVC 工具链）
- Node.js `>= 20` 与 `pnpm >= 9`

```powershell
cd apps/pbz-amm-desktop
pnpm install --frozen-lockfile
pnpm build
cd ../..

cargo test --workspace
cargo build --release --workspace
```

编译产物位于 `target/release/pbz-amm.exe` 与 `target/release/pbz-amm-desktop.exe`。

## 仓库结构

- `crates/pbz-amm-core`：核心引擎（游戏路径识别、安全解压与分类、容器索引冲突检查、暂存与硬链接部署、存档快照、Nexus 客户端、状态事件流）。
- `crates/pbz-amm-cli`：`pbz-amm` 命令行工具与 stdio MCP 服务。
- `apps/pbz-amm-desktop`：Tauri v2 + React 19 桌面端界面与命令桥接层。
- `skills/pbz-amm`：供 AI Agent 调用的技能说明。

## 开源协议

基于 [Apache License 2.0](LICENSE) 开源。
