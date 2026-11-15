---
name: pbz-amm
description: 使用 PBZ-AMM (pbz-amm) 管理《影之刃零》(Phantom Blade Zero) 的本地与 Nexus Mods 模组、多套配置方案 (Profile)、冲突检测、版本回滚与存档备份恢复。
---

# PBZ-AMM Agent 操作规范

当用户需要为《影之刃零》（Phantom Blade Zero）搜索、预检、安装、启用/禁用、回滚 Mod，切换纯净原版/练习配置，或者备份恢复存档时，始终通过 `pbz-amm --json` 命令（或 `pbz-amm mcp serve` 暴露的 MCP 工具）执行，**严禁手工向游戏目录随意解压覆盖文件**。

## 黄金安全准则

1. **先看状态**：首次操作前运行 `pbz-amm --json status`，确认游戏目录、前置框架（`ue4ss`、`mods_menu`、`pbz_mod_loader`、`cpp_pak_bypass`、`outfit_framework`）以及是否存在 `unmanaged` 未接管野生 Mod。
2. **遇 `needs_selection`（退出码 `10`）必须向用户确认**：
   - 当 `pbz-amm --json install <路径>` 返回 `"status": "needs_selection"` 时，读取 `selection.available_variants`、`selection.conflicts` 或 `selection.uncertain_files`；
   - 用自然语言向用户说明有哪些可选变体或具体哪几个文件/内部资产冲突，待用户拍板后再附带 `--select "<变体名>"` 或 `--allow-conflicts` 重新执行，**切勿擅自替用户猜测变体或强行覆盖**。
3. **遇 `blocked`（退出码 `20`）**：
   - 若提示游戏正在运行（`PBZ.exe`），请礼貌提醒用户先退出游戏；
   - 若免费 Nexus 账号返回 `awaiting_nxm_confirm`，说明已在浏览器打开确认下载页，请提示用户在网页点一次下载按钮即可自动接管。
4. **存档恢复必须经用户本人确认**：
   - 切回纯净原版（`pbz-amm --json profile switch vanilla`）只会卸载受管 Mod 文件，不会回退已被修改的存档内容；
   - 只有在用户明确同意恢复某份历史备份后，才可传入 `--confirm` 执行 `pbz-amm --json backup restore <id> --confirm`。
