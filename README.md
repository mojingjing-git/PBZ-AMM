# PBZ-AMM · Auto Mod(e) Manager for *Phantom Blade Zero*

> **《影之刃零》（Phantom Blade Zero）专属开源自动 Mod 管理器**  
> **Rust 单核心驱动 · 独立 CLI + `--json` · 内置 MCP 服务 + Agent Skill · Tauri v2 双主题武侠桌面端**  
> **开源协议**：Apache License 2.0

`PBZ-AMM`（名字致敬经典的 `MAA` 反写）是一款专为《影之刃零》PC 版打造的现代开源 Mod 管理器。所有界面形态（命令行 CLI、AI Agent 的 Skill / 本地 MCP 服务、以及 Tauri v2 桌面端 GUI）均共享同一个净室原创的 Rust 核心引擎 `pbz-amm-core` 与同一份本地数据仓库。

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

## 快速上手（Tauri 桌面端 GUI）

桌面端提供 **「夜雨暗」（暗色玄墨）** 与 **「宣纸浅」（水墨宣纸）** 两套武侠视觉主题（顶部一键切换并持久化），与 CLI/MCP 实时共享同一 `Data` 目录、文件锁及实时操作联动流：

- **五大功能视图**：
  1. **已装 Mod**：支持窗口全局拖入 `.zip/.7z/.rar/.pak` 或文件夹自动开启安装预检弹窗、手动 Mod 扫描勾选接管、多配置方案（`纯净原版` / `默认配置` / 自定义）一键切换、单模组启停与旧版一键回退。
  2. **前置与冲突**：实时感知 `UE4SS`、`Mods Menu (#149)`、`PBZModLoader (#113)`、`CPP Bypass (#520)`、`Outfit Framework (#903)` 及代理注入 DLL 槽位占用，展示文件与 `.pak/.utoc` 容器级冲突报告。
  3. **Nexus 工坊**：免登录检索《影之刃零》社区作品、查阅前置依赖、批量检查已装更新、3 步引导绑定账号；免费账号默认复用日常浏览器免二次登录并自动监听系统下载目录/`nxm://` 接管（也可选内置 WebView2 小窗），会员支持静默直连下载。
  4. **存档备份**：手动备注锁定快照、自动防损留底与二次确认安全恢复。
  5. **设置与接入**：绑定游戏目录、管理 Windows 系统凭据库中的 Nexus API Key、一键复制本地 MCP JSON 配置。

### 编译前提（从源码构建）

- **OS**：Windows 10 / 11（64 位，桌面端需系统内置 WebView2 Runtime）
- **Rust**：`>= 1.89`（MSVC 工具链）
- **Node.js & pnpm**：Node `>= 20`，`pnpm >= 9`
- **可选工具**：解压老旧 RAR5 压缩包时依赖 Windows 10/11 自带 `tar.exe` 或 `7z.exe`

```powershell
# 构建前端静态资源并编译全工作区（Release 版本位于 target\release\）
cd apps/pbz-amm-desktop
pnpm install
pnpm build
cd ../..
cargo test --workspace
cargo build --release --workspace
```

---

## 仓库结构

- `crates/pbz-amm-core`：统一核心引擎（游戏寻址、安全解压与分类器、Pak/IoStore 索引冲突引擎、硬链接与 Profile 事务部署器、存档快照环、Nexus 客户端）
- `crates/pbz-amm-cli`：`pbz-amm` 独立命令行工具 + 内置 `stdio` MCP Server
- `apps/pbz-amm-desktop`：Tauri v2 + React 19 克制暗色武侠风桌面端（直接链接 `pbz-amm-core`）
- `skills/pbz-amm/SKILL.md`：面向 AI Agent 的标准任务编排技能说明
