# PBZ-AMM · Auto Mod(e) Manager for *Phantom Blade Zero*

> **《影之刃零》（Phantom Blade Zero）专属开源自动 Mod 管理器**  
> **Rust 单核心驱动 · 独立 CLI + `--json` · 内置 MCP 服务 + Agent Skill · Tauri 暗色武侠桌面端（规划中）**  
> **开源协议**：Apache License 2.0

`PBZ-AMM`（名字致敬经典的 `MAA` 反写）是一款专为《影之刃零》PC 版打造的现代开源 Mod 管理器。所有界面形态（命令行 CLI、AI Agent 的 Skill / 本地 MCP 服务、以及后续的 Tauri 桌面 GUI）均共享同一个净室原创的 Rust 核心引擎 `pbz-amm-core`。

---

## 核心特性

1. **深度适配《影之刃零》真实目录与双脚本生态**
   - 自动识别 Steam（AppID `4115450`）、WeGame、Epic 的 `platform/<store>/PBZ.exe` 主程序结构，自动将压缩包内写死的商店路径（如 `platform/steam/...`）重定向至玩家实际平台目录，彻底杜绝误投外层启动壳或空置 `Binaries/Win64` 的常见陷阱。
   - 原生支持 **Pak / UE 5.7 IoStore（`.pak` + `.utoc` + `.ucas`）**、**蓝图 LogicMods**、**UE4SS（Lua + 原生 C++ DLL + 纯数据配置目录识别）**、**Mods Menu (`#149`)**、**PBZModLoader (`#113`)** 以及 11 月 4 日补丁后的 **CPP Bypass (`#520`)** 与 **Outfit Framework (`#903`)**。
2. **明确操作自动执行，遇歧义/冲突自动停下待选（Stop-on-Ambiguity）**
   - 自动检测压缩包内的**多选一互斥变体**（如长发/短发、不同倍率）、**双脚本加载器副本**（同时含 `Mods Menu` 与 `PBZModLoader` 脚本）以及**未知用途 DLL**，返回明确的选择提示与退出码（`exit 10`）。
3. **毫秒级 `.pak` / `.utoc` 容器内部资产与数据块冲突预检**
   - 无需解包数 GB 的模型贴图，直接只读解析 `.pak` 索引表与 UE5 IoStore `.utoc` 的 `DirectoryIndex` 虚拟路径树及 12 字节 `FIoChunkId` 指纹，精准定位两个外观/机制 Mod 是否改了同一个内部资产。
4. **独立 Staging 仓库 + 硬链接秒装 + 多套配置（Profile）切换**
   - 同盘默认使用 NTFS 硬链接部署（零双倍磁盘空间占用、毫秒级开关），跨盘自动回退复制；**绝不触碰或删除非本工具投递的野生文件**。
   - 内置 `vanilla`（纯净原版）与多套自定义 Profile 秒切，存档保持共用；更新 Mod 时自动保留玩家修改过的 `config.lua` / `config.json` / `.ini`，并保留上一版本支持 `rollback` 一键回滚。
5. **本地存档自动快照护栏**
   - 在切换 Profile、接管已有 Mod、安装功能型脚本 Mod 前自动打包备份 `ProjectPBZ/Saved/SaveGames`（受配额自动轮替保护，支持 `--pin` 永久保留备注节点）；恢复存档强制校验游戏已关闭并要求 `--confirm` 二次确认。
6. **Nexus Mods 官方接口集成（免费与会员双兼容）**
   - 免密钥直连官方 GraphQL v2 搜索《影之刃零》Mod、读取前置依赖与检查版本更新；API Key 安全存入 Windows 凭据管理器；会员账号支持全自动下载，免费账号支持注册当前用户 `nxm://` 协议通过网页一键确认接管。

---

## 快速上手（CLI）

```powershell
# 1. 查看游戏路径、已装前置、当前配置方案与未接管野生 Mod
pbz-amm status

# 2. 扫描并确认接管游戏目录里以前手动装过的 Mod
pbz-amm adopt
pbz-amm adopt all

# 3. 无损预检一个本地压缩包（查看变体与内部资产冲突）
pbz-amm inspect "D:\Downloads\BaiChilian.zip"

# 4. 安装或更新本地 Mod（多变体包可通过 --select 指定）
pbz-amm install "D:\Downloads\BaiChilian.zip" --select "LongHair"

# 5. 一键切换至“纯净原版”排错（存档保持共用），或切回默认方案
pbz-amm profile switch vanilla
pbz-amm profile switch default

# 6. 更新后不满意？一键回滚至上一版
pbz-amm rollback bai-chilian

# 7. 免登录在 Nexus 搜索 Mod / 检查已装 Mod 更新
pbz-amm nexus search "Outfit"
pbz-amm nexus check-updates

# 8. 备份与恢复存档
pbz-amm backup create --note "打最终Boss前" --pin
pbz-amm backup restore <backup_id> --confirm

# 9. 启动内置本地 MCP 服务（供 Claude / Antigravity / Cursor 等连接）
pbz-amm mcp serve
```

> 所有子命令均支持全局 `--json` 参数输出结构化结果。

---

## 仓库结构

- `crates/pbz-amm-core`：统一核心引擎（游戏寻址、安全解压与分类器、Pak/IoStore 索引冲突引擎、硬链接与 Profile 事务部署器、存档快照环、Nexus 客户端）
- `crates/pbz-amm-cli`：`pbz-amm` 独立命令行工具 + 内置 `stdio` MCP Server
- `skills/pbz-amm/SKILL.md`：面向 AI Agent 的标准任务编排技能说明
- `apps/pbz-amm-desktop` *(Milestone 3)*：Tauri v2 克制暗色武侠风桌面端（直接复用 `pbz-amm-core`）
