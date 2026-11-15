# PBZ-AMM 工程架构与技术契约

## 1. 模块边界

- **`crates/pbz-amm-core`**：唯一业务核心库，供 CLI、内置 MCP 服务以及后续 Tauri 桌面端共同链接调用，杜绝多端逻辑分叉。
  - `game.rs`：定位《影之刃零》（Steam AppID `4115450` / Epic / 手动绑定），解析 `platform/<store>/PBZ.exe` 主程序、检测运行中进程锁以及四大前置框架状态。
  - `scanner.rs`：安全解包（`.zip` / `.7z` / `.rar` / `.pak` / 文件夹，严格拦截 Zip-Slip 与内嵌可执行脚本）、多商店路径自动重写、多变体与双脚本加载器互斥识别。
  - `container.rs`：只读解析 `.pak`（`repak`）索引与 UE 5.7 IoStore `.utoc`（`FIoStoreTocHeader` + `FIoChunkId` 12 字节块指纹 + 未加密 `FIoDirectoryIndexResource` 虚拟路径树），毫秒级完成内部资产冲突检测。
  - `deployer.rs` & `state.rs`：单实例文件锁（`.pbz-amm.lock`）、Staging 独立仓库（保留当前版与上一版支持一键回滚）、同盘硬链接优先部署（跨盘自动回退复制）、保留用户编辑过的配置文件、安全维护 `enabled.txt` / `mods.txt` / `mods.ini`。
  - `backup.rs`：`ProjectPBZ/Saved/SaveGames` 自动与手动快照环，未加星标的自动备份按数量与体积配额淘汰，恢复前强制校验进程关闭与二次确认。
  - `nexus.rs`：官方 GraphQL v2（`gameId: 10614`，免密钥搜索、查依赖与批量检查更新）+ REST v1（Windows 凭据管理器存 Key、会员直连下载与免费账号 `HKCU\Software\Classes\nxm` 网页唤醒接管）。
- **`crates/pbz-amm-cli`**：独立无外部运行时依赖的 `pbz-amm.exe` 命令行工具，全命令支持 `--json` 统一信封及 `pbz-amm mcp serve` 本地 MCP 服务。

## 2. 自动化退出码契约

| 状态 (`status`) | 退出码 | 含义 |
| :--- | :--- | :--- |
| `ok` | `0` | 操作完成 |
| `needs_selection` | `10` | 存在多选一变体、文件/资产冲突、未知 DLL 或恢复存档未传 `--confirm`，等待用户或 Agent 选择确认 |
| `blocked` | `20` | 游戏正在运行、状态目录被另一实例占用，或免费 Nexus 账号正在等待网页点击 `nxm://` 唤醒 |
| `error` | `1` | 常规错误 |
