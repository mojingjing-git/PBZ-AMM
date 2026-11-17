export type UiLang = "zh" | "en";

export function formatProfileName(
  id: string,
  displayName: string,
  lang: UiLang
): string {
  if (lang === "en") {
    if (id === "vanilla") return "Vanilla";
    if (id === "default") return "Default";
  }
  return displayName;
}

export function formatStoreName(
  store: string | { custom: string } | undefined,
  lang: UiLang
): string {
  if (!store) return lang === "en" ? "Unknown" : "未知平台";
  if (typeof store === "string") return store.toUpperCase();
  return store.custom;
}

export const MESSAGES = {
  zh: {
    docTitle: "PBZ-AMM · 《影之刃零》Mod 管理器",
    common: {
      cancel: "取消",
      collapse: "收起",
      on: "开",
      off: "关",
      gotIt: "知道了",
    },
    sidebar: {
      appSub: "影之刃零 · Mod 管理器",
      connected: (store: string) => `◆ 已连接 (${store})`,
      gameNotBound: "◇ 未绑定游戏目录",
      refreshTitle: "刷新本地与 CLI 最新状态",
      footerTag: "Apache-2.0 · CLI & GUI 共享核心",
    },
    header: {
      currentProfile: "当前配置：",
      newProfile: "新建配置",
      themeAria: "界面主题切换",
      themeDark: "夜雨暗",
      themeDarkTitle: "切换为夜雨暗色武侠主题",
      themeLight: "宣纸浅",
      themeLightTitle: "切换为宣纸浅色水墨主题",
      langAria: "界面语言切换",
      langZhTitle: "切换为中文界面",
      langEnTitle: "Switch UI language to English",
    },
    tabs: {
      mods: { title: "已装 Mod", sub: "启用开关 · 安装与版本回退" },
      diagnostics: { title: "前置与冲突", sub: "框架检测 · 内部资产冲突排查" },
      nexus: { title: "Nexus 工坊", sub: "在线搜索 · 检查已装更新" },
      backups: { title: "存档备份", sub: "自动快照 · 安全确认恢复" },
      settings: { title: "设置与接入", sub: "游戏目录 · Nexus 密钥 · MCP" },
    },
    mods: {
      gameMissingTitle: "尚未定位《影之刃零》游戏目录",
      gameMissingFallback:
        "请手动选择包含 ProjectPBZ 与 platform 文件夹的游戏安装根目录。",
      pickGameDir: "选择游戏目录",
      dropzoneTitle: "拖入压缩包或文件夹即可安装",
      dropzoneSubPrefix: "支持 ",
      dropzoneSubSuffix:
        " 或解压目录；自动修正不同商店路径，遇到多选一版本或文件冲突时会自动停下供你确认。",
      pickArchive: "选择压缩包",
      pickFolder: "选择文件夹",
      unmanagedFound: (n: number) => `发现 ${n} 项手动安装的已有 Mod`,
      unmanagedHint:
        "勾选后可纳入管理器统一开关与备份；未勾选的文件将保持原位不动。",
      adoptBtn: (n: number) => `纳入管理 (${n})`,
      dividerSummary: (total: number, enabled: number) =>
        `共安装 ${total} 个 Mod · 当前配置已启用 ${enabled} 个`,
      filterPlaceholder: "搜索 Mod 名称 / ID / 类型...",
      emptyState:
        "暂未安装任何 Mod。可将下载好的压缩包直接拖入窗口，或前往「Nexus 工坊」搜索下载。",
      toggleOffTitle: "点击在当前配置中停用",
      toggleOnTitle: "点击在当前配置中启用",
      updateBadge: (ver: string) => `可更新 v${ver}`,
      variantMeta: (variant: string, files: number, containers: number) =>
        `变体：${variant} · ${files} 个文件${
          containers > 0 ? ` · ${containers} 个 Pak/IoStore 容器` : ""
        }`,
      rollbackBtn: (ver: string) => `回退 v${ver}`,
      removeTitle: "卸载此 Mod",
      dragOverlayTitle: "松开鼠标以预检并安装 Mod",
      dragOverlaySub:
        "自动检查压缩包结构、互斥可选版本与 .pak / .utoc 内部资产冲突",
    },
    diagnostics: {
      installed: "已安装",
      notInstalled: "未安装",
      viewNexus: (id: number) => `查看 Nexus #${id}`,
      frameworks: [
        {
          name: "UE4SS 脚本框架 (PBZ 专用版)",
          nxId: 13,
          key: "ue4ss" as const,
          desc: "位于 platform/<store>/dwmapi.dll 及 ue4ss/Mods/，用于运行 Lua 与原生 C++ 功能 Mod。",
        },
        {
          name: "Mods Menu (游戏内菜单框架)",
          nxId: 149,
          key: "mods_menu" as const,
          desc: "位于根目录 hid.dll 及 PBZModsMenu/Mods/，支持在游戏设置菜单或快捷键中直接开关 Mod。",
        },
        {
          name: "PBZModLoader (JS 脚本加载器)",
          nxId: 113,
          key: "pbz_mod_loader" as const,
          desc: "位于 ProjectPBZ/PBZModLoader/mods/，注意 v2.0 起仅支持加载编译好的 .js 脚本。",
        },
        {
          name: "CPP Pak Bypass (脚本包兼容补丁)",
          nxId: 520,
          key: "cpp_pak_bypass" as const,
          desc: "修复 11 月 4 日游戏更新后，包含 JavaScript 修改的 .pak 模组被拦截失效的问题。",
        },
        {
          name: "PBZ Outfit Framework (独立服装框架)",
          nxId: 903,
          key: "outfit_framework" as const,
          desc: "支持新增独立服装栏位，避免多套外观 Mod 互相替换同一件原版服装。",
        },
      ],
      proxyTitle: "代理注入 DLL 占用检测",
      proxySubBefore: "检测游戏目录中 ",
      proxySubAfter: " 等同名注入文件占用情况，防止冲突覆盖：",
      proxyEmpty: "当前未检测到代理注入 DLL",
      conflictTitle:
        "当前配置冲突检测（文件路径 + .pak / .utoc 内部资产与数据块）",
      conflictEmpty: "◆ 当前启用的 Mod 之间无任何文件或内部资产冲突。",
    },
    nexus: {
      searchPlaceholder:
        "免登录搜索 Nexus《影之刃零》Mod（如 QTE / Hold / Outfit，留空查看热门）...",
      searchBtn: "搜索 Mod",
      checkUpdatesBtn: "检查更新",
      authorDownloads: (author: string, downloads: number) =>
        `作者：${author} · 下载：${downloads} 次 · `,
      openPageBtn: "打开网页",
      downloadInstallBtn: "下载并安装",
      requirementsLabel: "前置要求：",
      noRequirements: " 无额外前置依赖",
      cardStats: (modId: number, author: string, downloads: number, cat?: string | null) =>
        `#${modId} · ${author} · ${downloads.toLocaleString()} 次下载${cat ? ` · ${cat}` : ""}`,
      noSummary: "暂无简介",
      detailsBtn: "详情与前置",
      openBrowserTitle: "在浏览器打开 Nexus 主页",
      downloadInspectBtn: "下载预检",
      auth: {
        premiumAccount: "会员 · 支持静默直连",
        freeAccount: "免费账号 · 支持网页点一下自动接管",
        keyStored: "密钥已存入系统凭据库",
        unbound: "未绑定账号",
        accountPrefix: "Nexus 账号：",
        nxmReady: "nxm:// 已就绪",
        nxmRegistered: "nxm:// 已注册",
        nxmUnregistered: "nxm:// 未注册",
        embeddedCompactLabel: "内置小窗打开（不勾选则复用日常浏览器免重登）",
        registerNxmOneClick: "一键注册 nxm://",
        manageBinding: "管理绑定",
        headerBound: "Nexus Mods 账号与 nxm:// 下载协议",
        headerUnbound: "绑定 Nexus Mods 账号（支持免费账号，3 步即可下载安装）",
        step1Prefix: "第 1 步：",
        step1BodyBeforeKey: "点右侧按钮在浏览器登录 Nexus，拉到页面最底部 ",
        step1BodyBetween: " 区域，点 ",
        step1BodyAfter: " 生成并复制密钥。",
        step2Prefix: "第 2 步：",
        step2Body:
          "把密钥粘贴到下方并点击「验证并绑定」（仅加密存于 Windows 凭据管理器，绝不明文落盘）。",
        step3Prefix: "第 3 步（免费号说明）：",
        step3BeforeStrong: "默认直接用你",
        step3Strong: "日常已登录的浏览器",
        step3Middle: "打开下载页（不用重新登录！），软件同时会自动监听系统下载目录与 ",
        step3After:
          "——你无论在网页点 Manual Download 还是 Mod Manager Download → Slow Download，下完都会自动弹出安装预检。",
        openKeyPageTitle: "在默认浏览器中打开 Nexus Personal API Key 页面",
        openKeyPageBtn: "打开 Nexus 获取密钥",
        keyPlaceholder: "粘贴 Nexus Personal API Key...",
        bindBtn: "验证并绑定（自动开启 nxm://）",
        registerOnlyBtn: "仅注册 nxm://",
        clearBtn: "清除密钥",
        embeddedFullLabel:
          "下载与打开网页时使用内置小窗（不勾选则复用日常浏览器免重登，自动接管下载）",
      },
    },
    backups: {
      manualTitle: "手动备份当前游戏存档 (SaveGames)",
      notePlaceholder: "输入备份备注（如：挑战 Boss 前 / 安装新 Mod 前）...",
      pinLabel: "永久保留（不被配额自动清理）",
      createBtn: "立即备份",
      emptyState:
        "暂无存档备份。在首次安装、卸载或切换配置方案前，系统会自动为你创建防损快照。",
      pinnedTag: "永久保留",
      meta: (note: string | null | undefined, fileCount: number, size: string) =>
        `${note ? `备注：${note} · ` : ""}包含 ${fileCount} 个存档文件 · ${size} · SHA-256: `,
      confirmPrompt: "确认覆盖当前存档？（请先退出游戏）",
      confirmRestoreBtn: "确认恢复",
      restoreBtn: "恢复此备份",
    },
    settings: {
      gameDirTitle: "《影之刃零》游戏目录设置",
      repickDirBtn: "重新选择目录",
      rootDir: "游戏根目录：",
      shippingExe: "主程序路径：",
      tildeModsDir: "Pak ~mods：",
      ue4ssDir: "UE4SS 目录：",
      saveDir: "存档目录：",
      gameNotBound: "尚未绑定游戏目录",
      mcpTitle: "CLI 命令行与 AI Agent (MCP) 接入配置",
      copied: "已复制",
      copyMcp: "复制 MCP 配置",
      mcpDescBefore: "共享数据目录：",
      mcpDescAfter: "。通过命令行或 MCP 执行的操作会自动同步展示在桌面端界面中：",
    },
    newProfileModal: {
      title: "新建 Mod 配置方案",
      idPlaceholder: "英文标识 ID（如 practice / outfits）",
      namePlaceholder: "配置显示名称（如 练习模式 / 纯外观）",
      descPlaceholder: "备注说明（可选）",
      cloneLabel: "复制当前配置的 Mod 启用状态（游戏存档始终共用）",
      createBtn: "创建配置",
    },
    inspectModal: {
      titlePrefix: "安装预检 · ",
      agentSynced:
        "已同步 CLI / Agent 预检结果：可直接在此选择并完成安装，也可回到命令行继续确认",
      sourcePath: "来源路径：",
      securityPrefix: "安全提示：",
      securityBody: (count: number) =>
        `已自动忽略包内附带的 ${count} 个可执行文件/脚本（不会运行任何外部程序）。`,
      variantsPrompt: (count: number) =>
        `检测到 ${count} 个互斥可选版本（变体），请选择要安装的一项：`,
      variantFileCount: (count: number) => `${count} 个文件`,
      deployPreviewPrefix: "文件部署预览 · ",
      targetManifest: "目标位置清单",
      userConfigSuffix: " (配置文件·更新时自动保留)",
      containersSummary: (count: number, assets: number, chunks: number) =>
        `已解析容器包：${count} 个（共扫描 ${assets} 条内部资产路径 / ${chunks} 个 IoStore 数据块）`,
      blockingPrefix: "无法安装：",
      conflictsDetected: (count: number) =>
        `检测到 ${count} 项文件或内部资产冲突：`,
      allowConflictsLabel: "我已了解上述覆盖关系，确认继续安装",
      uncertainTitle: "包含未识别用途的 DLL 文件：",
      allowUncertainLabel: "信任此文件来源并允许放入游戏目录",
      installing: "正在安装...",
      confirmInstall: "确认安装并启用",
    },
    overlay: {
      started: "执行中",
      succeeded: "已完成",
      needsSelection: "待选择",
      failed: "失败",
      syncing: (actor: string) => `${actor.toUpperCase()} 同步中`,
      drawerTitle: "CLI / Agent 操作记录",
      emptyBeforeCmd: "暂无外部命令记录。当你在终端或 AI 对话中调用 ",
      emptyAfterCmd: " 时，界面会自动切换对应页面并实时同步状态。",
    },
    toasts: {
      readDashFailed: (err: string) => `读取核心状态失败：${err}`,
      inspectFailed: "预检 Mod 包失败",
      downloadedOpeningInspect: "下载完成，正在打开安装预检...",
      nxmCaptured: "已捕获下载链接，正在拉取压缩包...",
      embeddedDlStarted: "内置浏览窗已开始下载，完成后将自动接管...",
      embeddedDlFailed: "内置浏览窗下载失败",
      nexusSearchFailed: "Nexus 搜索失败",
      gameDirBound: "已绑定《影之刃零》安装目录",
      gameDirInvalid: "游戏目录校验未通过",
      modInstalled: "Mod 安装完成并已在当前配置中启用",
      installFailed: "安装失败",
      openBrowserFailed: "打开浏览器失败",
      pasteNexusKey: "请先粘贴有效的 Nexus Personal API Key",
      nexusBound: (name: string, isPremium: boolean) =>
        `已绑定 Nexus 账号「${name}」（${isPremium ? "会员" : "免费账号"}），并已开启 nxm:// 协议`,
      keyVerifyFailed: "密钥验证失败，请检查是否复制完整",
      nxmRegistered: "已注册 nxm:// 浏览器接管协议",
      registerFailed: "注册失败",
      keyCleared: "已清除保存的 Nexus API Key",
      needNexusKeyFirst: "请先按上方第 1~2 步绑定 Nexus 账号（免费账号即可）",
      hintEmbedded: (modId: number) =>
        `已打开内置 Nexus 浏览窗（#${modId}）：请在该小窗内点击「Slow Download（慢速下载）」，完成后小窗会自动关闭并弹出安装预检。`,
      clickSlowInEmbedded: "请在弹出的内置浏览窗点击 Slow Download",
      hintSystemBrowser: (modId: number, watchDir?: string) => {
        const w = watchDir ? `（已自动监听 ${watchDir}）` : "";
        return `已用你的日常浏览器打开 #${modId} 下载页（直接复用已登录状态，无需二次登录）${w}：点网页上的「Manual Download / Mod Manager → Slow Download」后，软件会自动抓取压缩包并弹出安装预检！`;
      },
      openedInSystemBrowser: "已在默认浏览器打开，点完 Slow Download 会自动弹出预检",
      hintBlocked:
        "请在内置浏览窗或浏览器点击「Slow Download（慢速下载）」，完成后会自动回传给 PBZ-AMM 并开始安装预检。",
      clickSlowConfirm: "请点击网页里的 Slow Download 确认下载",
      downloadFailed: "下载失败，可尝试点「打开网页」手动下载压缩包后拖入窗口",
      switchedProfile: (name: string) => `已切换至「${name}」（游戏存档保持共用）`,
      switchProfileFailed: "切换配置失败",
      adoptedSuccess: "所选 Mod 已纳入管理",
      adoptFailed: "纳入管理失败",
      toggleStateFailed: "切换状态失败",
      rollbackSuccess: (ver: string) => `已回退至上一版本 v${ver}`,
      rollbackFailed: "回退失败",
      removedMod: (name: string) => `已卸载：${name}`,
      removeFailed: "卸载失败",
      frameworkDetailsFailed: "读取前置详情失败",
      updatesFound: (count: number) => `发现 ${count} 个已装 Mod 有可用更新`,
      allUpToDate: "已关联 Nexus 的 Mod 均已是最新版本",
      checkUpdatesFailed: "检查更新失败",
      modDetailsFailed: "读取 Mod 详情失败",
      backupCreated: "存档备份已完成（含 SHA-256 完整性校验）",
      backupFailed: "备份失败",
      backupRestored: "存档已安全恢复（恢复前状态已自动留底）",
      restoreFailed: "恢复失败",
      copyMcpFailed: "复制失败，请手动选中下方配置文本复制",
      profileMissingFields: "请填写英文标识 ID 与显示名称",
      profileCreated: "新配置方案已创建",
      profileCreateFailed: "创建失败",
    },
  },
  en: {
    docTitle: "PBZ-AMM · Phantom Blade Zero Mod Manager",
    common: {
      cancel: "Cancel",
      collapse: "Collapse",
      on: "ON",
      off: "OFF",
      gotIt: "Got it",
    },
    sidebar: {
      appSub: "Phantom Blade Zero · Mod Manager",
      connected: (store: string) => `◆ Connected (${store})`,
      gameNotBound: "◇ Game Directory Not Set",
      refreshTitle: "Refresh local & CLI state",
      footerTag: "Apache-2.0 · Shared CLI & GUI Core",
    },
    header: {
      currentProfile: "Profile:",
      newProfile: "New Profile",
      themeAria: "Switch UI theme",
      themeDark: "Ink Dark",
      themeDarkTitle: "Switch to Ink Night Dark theme",
      themeLight: "Paper Light",
      themeLightTitle: "Switch to Rice Paper Light theme",
      langAria: "Switch UI language",
      langZhTitle: "切换为中文界面",
      langEnTitle: "Switch UI language to English",
    },
    tabs: {
      mods: { title: "Installed Mods", sub: "Enable / Disable · Install & Rollback" },
      diagnostics: {
        title: "Frameworks & Conflicts",
        sub: "Prerequisites · Asset & Chunk Audit",
      },
      nexus: { title: "Nexus Workshop", sub: "Browse Mods · Check Updates" },
      backups: { title: "Save Backups", sub: "Auto Snapshots · Safe Restore" },
      settings: { title: "Settings & MCP", sub: "Game Path · Nexus Key · Agent" },
    },
    mods: {
      gameMissingTitle: "Phantom Blade Zero directory not located",
      gameMissingFallback:
        "Select the game root folder containing both ProjectPBZ and platform.",
      pickGameDir: "Select Game Folder",
      dropzoneTitle: "Drop an archive or folder here to install",
      dropzoneSubPrefix: "Supports ",
      dropzoneSubSuffix:
        " or extracted folders. Store paths are normalized automatically, pausing for variant choices or conflicts.",
      pickArchive: "Choose Archive",
      pickFolder: "Choose Folder",
      unmanagedFound: (n: number) => `Found ${n} manually installed mod(s)`,
      unmanagedHint:
        "Select items to adopt into PBZ-AMM for toggling and backups; unchecked files remain untouched.",
      adoptBtn: (n: number) => `Adopt (${n})`,
      dividerSummary: (total: number, enabled: number) =>
        `${total} Installed · ${enabled} Enabled in Current Profile`,
      filterPlaceholder: "Filter by name / ID / category...",
      emptyState:
        "No mods installed yet. Drop an archive into this window or browse Nexus Workshop to download one.",
      toggleOffTitle: "Click to disable in current profile",
      toggleOnTitle: "Click to enable in current profile",
      updateBadge: (ver: string) => `Update v${ver}`,
      variantMeta: (variant: string, files: number, containers: number) =>
        `Variant: ${variant} · ${files} file(s)${
          containers > 0 ? ` · ${containers} Pak/IoStore container(s)` : ""
        }`,
      rollbackBtn: (ver: string) => `Rollback v${ver}`,
      removeTitle: "Uninstall this mod",
      dragOverlayTitle: "Release to inspect and install mod",
      dragOverlaySub:
        "Inspecting archive layout, mutually exclusive variants, and .pak / .utoc asset overlaps",
    },
    diagnostics: {
      installed: "Installed",
      notInstalled: "Missing",
      viewNexus: (id: number) => `View Nexus #${id}`,
      frameworks: [
        {
          name: "UE4SS Script Framework (PBZ Build)",
          nxId: 13,
          key: "ue4ss" as const,
          desc: "Installed at platform/<store>/dwmapi.dll and ue4ss/Mods/ for Lua and C++ mods.",
        },
        {
          name: "Mods Menu (In-Game Menu)",
          nxId: 149,
          key: "mods_menu" as const,
          desc: "Installed at root hid.dll and PBZModsMenu/Mods/ to toggle mods from the game menu or hotkeys.",
        },
        {
          name: "PBZModLoader (JS Script Loader)",
          nxId: 113,
          key: "pbz_mod_loader" as const,
          desc: "Located in ProjectPBZ/PBZModLoader/mods/. Note: v2.0+ loads compiled .js scripts only.",
        },
        {
          name: "CPP Pak Bypass (JS Compatibility Patch)",
          nxId: 520,
          key: "cpp_pak_bypass" as const,
          desc: "Restores JS-modifying .pak mods blocked after the Nov 4 game patch.",
        },
        {
          name: "PBZ Outfit Framework",
          nxId: 903,
          key: "outfit_framework" as const,
          desc: "Adds standalone outfit slots so multiple cosmetic mods don't overwrite the same vanilla outfit.",
        },
      ],
      proxyTitle: "Proxy Injector DLL Occupancy",
      proxySubBefore: "Checks the game directory for proxy DLLs such as ",
      proxySubAfter: " to prevent accidental overwrites:",
      proxyEmpty: "No proxy injector DLLs detected",
      conflictTitle:
        "Active Profile Conflict Check (File Paths + .pak / .utoc Assets & Chunks)",
      conflictEmpty:
        "◆ No file path or internal asset conflicts among enabled mods.",
    },
    nexus: {
      searchPlaceholder:
        "Search Nexus Mods for PBZ (e.g. QTE / Hold / Outfit; leave blank for popular)...",
      searchBtn: "Search",
      checkUpdatesBtn: "Check Updates",
      authorDownloads: (author: string, downloads: number) =>
        `Author: ${author} · Downloads: ${downloads.toLocaleString()} · `,
      openPageBtn: "Open Page",
      downloadInstallBtn: "Download & Install",
      requirementsLabel: "Requirements:",
      noRequirements: " None",
      cardStats: (modId: number, author: string, downloads: number, cat?: string | null) =>
        `#${modId} · ${author} · ${downloads.toLocaleString()} downloads${
          cat ? ` · ${cat}` : ""
        }`,
      noSummary: "No description provided.",
      detailsBtn: "Details & Reqs",
      openBrowserTitle: "Open Nexus mod page in browser",
      downloadInspectBtn: "Download & Inspect",
      auth: {
        premiumAccount: "Premium · Direct API download",
        freeAccount: "Free · Browser auto-capture",
        keyStored: "API Key saved in Credential Manager",
        unbound: "Not linked",
        accountPrefix: "Nexus Account: ",
        nxmReady: "nxm:// Ready",
        nxmRegistered: "nxm:// Registered",
        nxmUnregistered: "nxm:// Unregistered",
        embeddedCompactLabel:
          "Use in-app browser window (uncheck to reuse your default browser without re-login)",
        registerNxmOneClick: "Register nxm://",
        manageBinding: "Manage Account",
        headerBound: "Nexus Mods Account & nxm:// Protocol",
        headerUnbound: "Link Nexus Mods Account (Free accounts supported, 3 steps)",
        step1Prefix: "Step 1: ",
        step1BodyBeforeKey:
          "Click the button below to sign in to Nexus, scroll down to ",
        step1BodyBetween: ", then click ",
        step1BodyAfter: " and copy your key.",
        step2Prefix: "Step 2: ",
        step2Body:
          'Paste the key below and click "Verify & Bind" (encrypted in Windows Credential Manager; never written in plaintext).',
        step3Prefix: "Step 3 (Free Accounts): ",
        step3BeforeStrong: "By default, download pages open in your ",
        step3Strong: "default logged-in browser",
        step3Middle:
          " (no extra login!) while PBZ-AMM monitors your Downloads folder & ",
        step3After:
          " — click Manual Download or Mod Manager Download → Slow Download and inspection opens automatically.",
        openKeyPageTitle: "Open Nexus Personal API Key page in browser",
        openKeyPageBtn: "Get API Key on Nexus",
        keyPlaceholder: "Paste Nexus Personal API Key...",
        bindBtn: "Verify & Bind (auto-register nxm://)",
        registerOnlyBtn: "Register nxm:// Only",
        clearBtn: "Clear Key",
        embeddedFullLabel:
          "Use built-in WebView window for pages/downloads (uncheck to reuse your default browser session)",
      },
    },
    backups: {
      manualTitle: "Create Manual Save Backup (SaveGames)",
      notePlaceholder: "Optional backup note (e.g. Before boss / Before new mod)...",
      pinLabel: "Pin forever (exclude from auto-pruning quota)",
      createBtn: "Backup Now",
      emptyState:
        "No save backups yet. Automatic snapshots are created before installs, removals, or profile switches.",
      pinnedTag: "Pinned",
      meta: (note: string | null | undefined, fileCount: number, size: string) =>
        `${note ? `Note: ${note} · ` : ""}${fileCount} save file(s) · ${size} · SHA-256: `,
      confirmPrompt: "Overwrite current saves? (Exit the game first)",
      confirmRestoreBtn: "Confirm Restore",
      restoreBtn: "Restore Backup",
    },
    settings: {
      gameDirTitle: "Phantom Blade Zero Directory",
      repickDirBtn: "Change Directory",
      rootDir: "Game Root: ",
      shippingExe: "Executable: ",
      tildeModsDir: "Pak ~mods: ",
      ue4ssDir: "UE4SS Mods: ",
      saveDir: "SaveGames: ",
      gameNotBound: "Game directory not bound yet",
      mcpTitle: "CLI & AI Agent (MCP) Integration",
      copied: "Copied",
      copyMcp: "Copy MCP Config",
      mcpDescBefore: "Shared data directory: ",
      mcpDescAfter:
        ". Actions run via CLI or MCP sync live into this desktop UI:",
    },
    newProfileModal: {
      title: "New Mod Profile",
      idPlaceholder: "Profile ID (ASCII, e.g. practice / outfits)",
      namePlaceholder: "Display Name (e.g. Practice / Cosmetics Only)",
      descPlaceholder: "Description (optional)",
      cloneLabel: "Clone enabled mods from active profile (saves are always shared)",
      createBtn: "Create Profile",
    },
    inspectModal: {
      titlePrefix: "Install Inspection · ",
      agentSynced:
        "Synced from CLI / Agent inspection: confirm below or continue from the terminal",
      sourcePath: "Source: ",
      securityPrefix: "Security Notice: ",
      securityBody: (count: number) =>
        `Ignored ${count} executable/script file(s) in archive (no external programs will run).`,
      variantsPrompt: (count: number) =>
        `Detected ${count} mutually exclusive variants. Select one to install:`,
      variantFileCount: (count: number) => `${count} file(s)`,
      deployPreviewPrefix: "Deployment Preview · ",
      targetManifest: "Target File Manifest",
      userConfigSuffix: " (Config · preserved on update)",
      containersSummary: (count: number, assets: number, chunks: number) =>
        `Parsed ${count} container(s): ${assets} asset path(s) / ${chunks} IoStore chunk(s)`,
      blockingPrefix: "Blocked: ",
      conflictsDetected: (count: number) =>
        `Detected ${count} file path or internal asset conflict(s):`,
      allowConflictsLabel: "I understand these overwrites and want to proceed",
      uncertainTitle: "Unrecognized DLL file(s) detected:",
      allowUncertainLabel: "I trust this source and allow deploying these DLLs",
      installing: "Installing...",
      confirmInstall: "Confirm Install & Enable",
    },
    overlay: {
      started: "Running",
      succeeded: "Done",
      needsSelection: "Action Needed",
      failed: "Failed",
      syncing: (actor: string) => `${actor.toUpperCase()} SYNC`,
      drawerTitle: "CLI / Agent Activity Log",
      emptyBeforeCmd: "No external commands yet. Running ",
      emptyAfterCmd:
        " in a terminal or via AI MCP automatically syncs state and highlights changes here.",
    },
    toasts: {
      readDashFailed: (err: string) => `Failed to load dashboard state: ${err}`,
      inspectFailed: "Failed to inspect mod package",
      downloadedOpeningInspect: "Download complete — opening inspection...",
      nxmCaptured: "Download link captured — fetching archive...",
      embeddedDlStarted:
        "Built-in browser download started — will auto-capture on completion...",
      embeddedDlFailed: "Built-in browser download failed",
      nexusSearchFailed: "Nexus search failed",
      gameDirBound: "Phantom Blade Zero directory bound",
      gameDirInvalid: "Game directory validation failed",
      modInstalled: "Mod installed and enabled in current profile",
      installFailed: "Installation failed",
      openBrowserFailed: "Failed to open browser",
      pasteNexusKey: "Please paste a valid Nexus Personal API Key first",
      nexusBound: (name: string, isPremium: boolean) =>
        `Linked Nexus account "${name}" (${isPremium ? "Premium" : "Free"}) and registered nxm://`,
      keyVerifyFailed: "API key verification failed — check for missing characters",
      nxmRegistered: "Registered nxm:// protocol handler",
      registerFailed: "Registration failed",
      keyCleared: "Cleared saved Nexus API Key",
      needNexusKeyFirst:
        "Link your Nexus account in steps 1–2 above first (free accounts work)",
      hintEmbedded: (modId: number) =>
        `Opened built-in Nexus window (#${modId}): click "Slow Download" inside that window; it will close automatically and launch inspection once downloaded.`,
      clickSlowInEmbedded: 'Click "Slow Download" in the built-in browser window',
      hintSystemBrowser: (modId: number, watchDir?: string) => {
        const w = watchDir ? ` (watching ${watchDir})` : "";
        return `Opened #${modId} in your default browser${w}: click "Manual Download" or "Mod Manager → Slow Download" and PBZ-AMM will capture the archive and open inspection automatically.`;
      },
      openedInSystemBrowser:
        'Opened in default browser — click "Slow Download" to auto-inspect',
      hintBlocked:
        'Click "Slow Download" in the browser window; PBZ-AMM will capture the download and launch inspection automatically.',
      clickSlowConfirm: 'Click "Slow Download" on the webpage to start downloading',
      downloadFailed:
        'Download failed. Try "Open Page", download manually, and drop the archive here.',
      switchedProfile: (name: string) =>
        `Switched to "${name}" (game saves remain shared)`,
      switchProfileFailed: "Failed to switch profile",
      adoptedSuccess: "Selected mods adopted into manager",
      adoptFailed: "Failed to adopt mods",
      toggleStateFailed: "Failed to toggle mod state",
      rollbackSuccess: (ver: string) => `Rolled back to v${ver}`,
      rollbackFailed: "Rollback failed",
      removedMod: (name: string) => `Uninstalled: ${name}`,
      removeFailed: "Failed to uninstall mod",
      frameworkDetailsFailed: "Failed to load framework details",
      updatesFound: (count: number) => `Found updates for ${count} installed mod(s)`,
      allUpToDate: "All Nexus-linked mods are up to date",
      checkUpdatesFailed: "Update check failed",
      modDetailsFailed: "Failed to load mod details",
      backupCreated: "Save backup created (SHA-256 verified)",
      backupFailed: "Failed to create backup",
      backupRestored: "Saves restored safely (pre-restore snapshot saved)",
      restoreFailed: "Failed to restore backup",
      copyMcpFailed: "Copy failed — please select and copy the JSON manually",
      profileMissingFields: "Enter both Profile ID and Display Name",
      profileCreated: "New profile created",
      profileCreateFailed: "Failed to create profile",
    },
  },
} as const;
