import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  ArchiveRestore,
  Check,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  FolderSearch,
  PackagePlus,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { InspectModal } from "./components/InspectModal";
import { NexusAccountInfo, NexusAuthPanel } from "./components/NexusAuthPanel";
import { PuppeteerOverlay } from "./components/PuppeteerOverlay";
import {
  InkDivider,
  LozengeSwitch,
  SealCheck,
  SvgInkDefs,
  WuxiaPlaque,
} from "./components/WuxiaPrimitives";
import {
  AgentActivityEvent,
  DashboardData,
  InspectPayload,
  NexusModSummary,
  UiEnvelope,
} from "./types";

type NavTab = "mods" | "diagnostics" | "nexus" | "backups" | "settings";

interface NexusModDetailsData {
  summary: NexusModSummary;
  requirements: Array<{ mod_id: number; name: string; notes?: string | null }>;
}

interface UpdateEntry {
  mod_id: string;
  nexus_mod_id: number;
  name: string;
  current: string;
  latest: string;
  page_url: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatStore(store: string | { custom: string } | undefined): string {
  if (!store) return "未知平台";
  if (typeof store === "string") return store.toUpperCase();
  return store.custom;
}

export default function App() {
  const [tab, setTab] = useState<NavTab>("mods");
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState<{ text: string; isErr?: boolean } | null>(null);

  const [modFilter, setModFilter] = useState("");
  const [selectedWildIds, setSelectedWildIds] = useState<string[]>([]);

  const [inspectData, setInspectData] = useState<{
    payload: InspectPayload;
    triggeredByAgent?: boolean;
    nexusId?: number;
    version?: string;
  } | null>(null);

  const [showNewProfile, setShowNewProfile] = useState(false);
  const [newProfId, setNewProfId] = useState("");
  const [newProfName, setNewProfName] = useState("");
  const [newProfDesc, setNewProfDesc] = useState("");
  const [newProfClone, setNewProfClone] = useState(true);

  const [nxKeyword, setNxKeyword] = useState("");
  const [nxResults, setNxResults] = useState<NexusModSummary[]>([]);
  const [nxLoadedOnce, setNxLoadedOnce] = useState(false);
  const [nxDetails, setNxDetails] = useState<NexusModDetailsData | null>(null);
  const [nxUpdates, setNxUpdates] = useState<UpdateEntry[]>([]);
  const [browserConfirmHint, setBrowserConfirmHint] = useState<string | null>(null);

  const [backupNote, setBackupNote] = useState("");
  const [backupPin, setBackupPin] = useState(false);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);

  const [nexusAccount, setNexusAccount] = useState<NexusAccountInfo | null>(null);
  const [useEmbeddedBrowser, setUseEmbeddedBrowser] = useState(false);
  const [copiedMcp, setCopiedMcp] = useState(false);

  // 1 + A: Clean Live Agent Sync State
  const [activityLog, setActivityLog] = useState<AgentActivityEvent[]>([]);
  const [activeBanner, setActiveBanner] = useState<{
    actor: string;
    summary: string;
    phase: string;
  } | null>(null);
  const [pulsedKey, setPulsedKey] = useState<string | null>(null);

  const lastUserTouchRef = useRef<number>(0);
  const hideBannerTimerRef = useRef<number | null>(null);
  const tabRef = useRef<NavTab>(tab);
  tabRef.current = tab;

  const notify = useCallback((text: string, isErr = false) => {
    setToast({ text, isErr });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const scheduleClearSyncState = useCallback((ms = 3000) => {
    if (hideBannerTimerRef.current) {
      window.clearTimeout(hideBannerTimerRef.current);
    }
    hideBannerTimerRef.current = window.setTimeout(() => {
      setActiveBanner(null);
      setPulsedKey(null);
    }, ms);
  }, []);

  const refreshDashboard = useCallback(async () => {
    try {
      const env = await invoke<UiEnvelope<DashboardData>>("cmd_get_dashboard");
      if (env.status === "ok" && env.data) {
        setDash(env.data);
        setSelectedWildIds((prev) =>
          prev.filter((id) => env.data!.unmanaged.some((u) => u.id === id))
        );
      }
    } catch (e) {
      notify(`读取核心状态失败：${String(e)}`, true);
    }
  }, [notify]);

  useEffect(() => {
    void refreshDashboard();
    invoke<UiEnvelope<AgentActivityEvent[]>>("cmd_get_recent_activity")
      .then((env) => {
        if (env.status === "ok" && env.data) {
          setActivityLog(env.data);
        }
      })
      .catch(() => {});
  }, [refreshDashboard]);

  // Subscribe to live CLI / MCP Agent events (1 + A: Auto tab follow + highlight + Dual-end Modal)
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unAct: (() => void) | undefined;
    let unState: (() => void) | undefined;

    listen<AgentActivityEvent>("amm://activity", (e) => {
      const ev = e.payload;
      setActivityLog((prev) => [...prev.slice(-59), ev]);
      setActiveBanner({ actor: ev.actor, summary: ev.summary, phase: ev.phase });

      const activeTag = document.activeElement?.tagName;
      const userTyping = activeTag === "INPUT" || activeTag === "TEXTAREA";
      const userIdle = !userTyping && Date.now() - lastUserTouchRef.current > 2800;

      const nextTab = ev.tab_hint as NavTab | undefined;
      if (
        userIdle &&
        nextTab &&
        ["mods", "diagnostics", "nexus", "backups", "settings"].includes(nextTab) &&
        nextTab !== tabRef.current
      ) {
        setTab(nextTab);
      }

      if (ev.target_selector) {
        setPulsedKey(ev.target_selector);
        window.setTimeout(() => {
          const el = document.querySelector(ev.target_selector!) as HTMLElement | null;
          el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }, 120);
      }

      const p = ev.payload;
      if (p) {
        if (typeof p.keyword === "string") setNxKeyword(p.keyword);
        if (Array.isArray(p.results)) {
          setNxResults(p.results);
          setNxLoadedOnce(true);
        }
        if (p.details?.summary) setNxDetails(p.details);
        if (Array.isArray(p.updates)) setNxUpdates(p.updates);

        // Option A: Auto-open InspectModal when CLI/MCP inspects or pauses for selection
        if (p.inspect?.report) {
          setInspectData({
            payload: p.inspect,
            triggeredByAgent: true,
            nexusId: p.nexus_id ?? undefined,
            version: p.version ?? undefined,
          });
        }
        if (ev.action === "install" && ev.phase === "succeeded") {
          setInspectData((cur) => (cur?.triggeredByAgent ? null : cur));
        }
      }

      if (ev.phase !== "started") {
        void refreshDashboard();
        scheduleClearSyncState(ev.phase === "needs_selection" ? 5000 : 3000);
      } else if (hideBannerTimerRef.current) {
        window.clearTimeout(hideBannerTimerRef.current);
      }
    }).then((fn) => {
      unAct = fn;
    });

    listen("amm://state-changed", () => {
      void refreshDashboard();
    }).then((fn) => {
      unState = fn;
    });

    return () => {
      if (unAct) unAct();
      if (unState) unState();
    };
  }, [refreshDashboard, scheduleClearSyncState]);

  const inspectPath = useCallback(
    async (path: string, nexusId?: number, version?: string) => {
      setBusy(true);
      try {
        const env = await invoke<UiEnvelope<InspectPayload>>("cmd_inspect_source", { path });
        if (env.status === "ok" && env.data) {
          setInspectData({ payload: env.data, nexusId, version });
        } else {
          notify(env.error ?? "预检 Mod 包失败", true);
        }
      } finally {
        setBusy(false);
      }
    },
    [notify]
  );

  // Listen for in-app embedded Nexus browser download completions
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unDl: (() => void) | undefined;
    let unEvt: (() => void) | undefined;

    listen<{ path: string; nexus_mod_id?: number | null; version?: string | null }>(
      "amm://nexus-downloaded",
      (e) => {
        setBrowserConfirmHint(null);
        notify("内置浏览窗下载完成，正在打开安装预检...");
        void inspectPath(
          e.payload.path,
          e.payload.nexus_mod_id ?? undefined,
          e.payload.version ?? undefined
        );
      }
    ).then((fn) => {
      unDl = fn;
    });

    listen<{ kind: string; message?: string; mod_id?: number }>(
      "amm://nexus-browser-event",
      (e) => {
        if (e.payload.kind === "nxm_started") {
          notify("已捕获下载链接，正在拉取压缩包...");
        } else if (e.payload.kind === "http_started") {
          notify("内置浏览窗已开始下载，完成后将自动接管...");
        } else if (e.payload.kind === "error") {
          notify(e.payload.message ?? "内置浏览窗下载失败", true);
        }
      }
    ).then((fn) => {
      unEvt = fn;
    });

    return () => {
      if (unDl) unDl();
      if (unEvt) unEvt();
    };
  }, [inspectPath, notify]);

  // Native window drag & drop
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "enter" || p.type === "over") {
          setDragging(true);
        } else if (p.type === "drop") {
          setDragging(false);
          if (p.paths.length > 0) void inspectPath(p.paths[0]);
        } else {
          setDragging(false);
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      if (unlisten) unlisten();
    };
  }, [inspectPath]);

  const runNexusSearch = useCallback(
    async (kw?: string) => {
      setBusy(true);
      try {
        const clean = (kw ?? nxKeyword).trim();
        const env = await invoke<UiEnvelope<NexusModSummary[]>>("cmd_nexus_search", {
          keyword: clean ? clean : null,
          limit: 24,
        });
        if (env.status === "ok" && env.data) {
          setNxResults(env.data);
          setNxLoadedOnce(true);
        } else {
          notify(env.error ?? "Nexus 搜索失败", true);
        }
      } finally {
        setBusy(false);
      }
    },
    [nxKeyword, notify]
  );

  useEffect(() => {
    if (tab === "nexus" && !nxLoadedOnce) void runNexusSearch("");
  }, [tab, nxLoadedOnce, runNexusSearch]);

  useEffect(() => {
    if (!dash) return;
    if (!dash.has_nexus_key) {
      setNexusAccount(null);
      return;
    }
    if (nexusAccount) return;
    invoke<UiEnvelope<{ account?: NexusAccountInfo }>>("cmd_nexus_auth", {
      apiKey: null,
      clear: false,
      registerNxm: false,
    })
      .then((env) => {
        if (env.status === "ok" && env.data?.account) {
          setNexusAccount(env.data.account);
        }
      })
      .catch(() => {});
  }, [dash, nexusAccount]);

  const activeProfile = dash ? dash.profiles[dash.active_profile_id] ?? null : null;
  const enabledMap = useMemo(() => {
    const map = new Map<string, boolean>();
    if (activeProfile) {
      for (const e of activeProfile.entries) map.set(e.mod_id, e.enabled);
    }
    return map;
  }, [activeProfile]);

  const sortedMods = useMemo(() => {
    if (!dash) return [];
    const q = modFilter.trim().toLowerCase();
    return Object.values(dash.mods)
      .filter(
        (m) =>
          !q ||
          m.name.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q) ||
          m.current.categories.some((c) => c.toLowerCase().includes(q))
      )
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [dash, modFilter]);

  const sortedProfiles = useMemo(() => {
    if (!dash) return [];
    const order = ["vanilla", "default"];
    return Object.values(dash.profiles).sort((a, b) => {
      const ia = order.indexOf(a.id);
      const ib = order.indexOf(b.id);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a.display_name.localeCompare(b.display_name, "zh-CN");
    });
  }, [dash]);

  const handlePickGameDir = async () => {
    const picked = await invoke<string | null>("cmd_pick_game_dir");
    if (!picked) return;
    setBusy(true);
    try {
      const env = await invoke<UiEnvelope>("cmd_bind_game_dir", { path: picked });
      if (env.status === "ok") {
        notify("已绑定《影之刃零》安装目录");
        await refreshDashboard();
      } else notify(env.error ?? "游戏目录校验未通过", true);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmInstall = async (opts: {
    path: string;
    selectVariant?: string;
    allowConflicts: boolean;
    allowUncertain: boolean;
    nexusId?: number;
    version?: string;
  }) => {
    setBusy(true);
    try {
      const env = await invoke<UiEnvelope>("cmd_install_mod", {
        path: opts.path,
        selectVariant: opts.selectVariant ?? null,
        allowConflicts: opts.allowConflicts,
        allowUncertain: opts.allowUncertain,
        nexusId: opts.nexusId ?? null,
        version: opts.version ?? null,
      });
      if (env.status === "ok") {
        setInspectData(null);
        notify("Mod 安装完成并已在当前配置中启用");
        await refreshDashboard();
      } else notify(env.error ?? "安装失败", true);
    } finally {
      setBusy(false);
    }
  };

  const handleOpenUrl = useCallback(
    async (url: string) => {
      const env = await invoke<UiEnvelope>("cmd_open_url", {
        url,
        inAppBrowser: useEmbeddedBrowser,
      });
      if (env.status !== "ok") {
        notify(env.error ?? "打开浏览器失败", true);
      }
    },
    [notify, useEmbeddedBrowser]
  );

  const handleBindNexusKey = useCallback(
    async (rawKey: string): Promise<boolean> => {
      const key = rawKey.trim();
      if (!key) {
        notify("请先粘贴有效的 Nexus Personal API Key", true);
        return false;
      }
      setBusy(true);
      try {
        const env = await invoke<UiEnvelope<{ account?: NexusAccountInfo }>>("cmd_nexus_auth", {
          apiKey: key,
          clear: false,
          registerNxm: true,
        });
        if (env.status === "ok" && env.data?.account) {
          const acc = env.data.account;
          setNexusAccount(acc);
          notify(`已绑定 Nexus 账号「${acc.name}」（${acc.is_premium ? "会员" : "免费账号"}），并已开启 nxm:// 协议`);
          await refreshDashboard();
          return true;
        }
        notify(env.error ?? "密钥验证失败，请检查是否复制完整", true);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [notify, refreshDashboard]
  );

  const handleRegisterNxm = useCallback(async () => {
    setBusy(true);
    try {
      const env = await invoke<UiEnvelope>("cmd_nexus_auth", {
        apiKey: null,
        clear: false,
        registerNxm: true,
      });
      if (env.status === "ok") {
        notify("已注册 nxm:// 浏览器接管协议");
        await refreshDashboard();
      } else {
        notify(env.error ?? "注册失败", true);
      }
    } finally {
      setBusy(false);
    }
  }, [notify, refreshDashboard]);

  const handleClearNexusKey = useCallback(async () => {
    setBusy(true);
    try {
      await invoke("cmd_nexus_auth", { apiKey: null, clear: true, registerNxm: false });
      setNexusAccount(null);
      notify("已清除保存的 Nexus API Key");
      await refreshDashboard();
    } finally {
      setBusy(false);
    }
  }, [notify, refreshDashboard]);

  const handleDownloadAndInspect = async (modId: number) => {
    if (!dash?.has_nexus_key) {
      setTab("nexus");
      setPulsedKey("[data-agent-id='nexus-auth-guide']");
      notify("请先按上方第 1~2 步绑定 Nexus 账号（免费账号即可）", true);
      return;
    }
    setBusy(true);
    setBrowserConfirmHint(null);
    try {
      const env = await invoke<
        UiEnvelope<{
          awaiting_browser?: boolean;
          mode?: string;
          watch_dir?: string;
          url?: string;
          downloaded_path?: string;
          nexus_mod_id?: number;
          version?: string;
        }>
      >("cmd_nexus_download_stage", { modId, inAppBrowser: useEmbeddedBrowser });
      if (env.status === "ok" && env.data) {
        if (env.data.awaiting_browser) {
          if (env.data.mode === "embedded") {
            setBrowserConfirmHint(
              `已打开内置 Nexus 浏览窗（#${modId}）：请在该小窗内点击「Slow Download（慢速下载）」，完成后小窗会自动关闭并弹出安装预检。`
            );
            notify("请在弹出的内置浏览窗点击 Slow Download");
          } else {
            const wdir = env.data.watch_dir ? `（已自动监听 ${env.data.watch_dir}）` : "";
            setBrowserConfirmHint(
              `已用你的日常浏览器打开 #${modId} 下载页（直接复用已登录状态，无需二次登录）${wdir}：点网页上的「Manual Download / Mod Manager → Slow Download」后，软件会自动抓取压缩包并弹出安装预检！`
            );
            notify("已在默认浏览器打开，点完 Slow Download 会自动弹出预检");
          }
        } else if (env.data.downloaded_path) {
          notify("下载完成，正在打开安装预检...");
          await inspectPath(env.data.downloaded_path, env.data.nexus_mod_id, env.data.version);
        }
      } else if (env.status === "blocked") {
        setBrowserConfirmHint(
          `请在内置浏览窗或浏览器点击「Slow Download（慢速下载）」，完成后会自动回传给 PBZ-AMM 并开始安装预检。`
        );
        notify("请点击网页里的 Slow Download 确认下载");
        await refreshDashboard();
      } else {
        notify(env.error ?? "下载失败，可尝试点「打开网页」手动下载压缩包后拖入窗口", true);
      }
    } finally {
      setBusy(false);
    }
  };

  const mcpSnippet = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            "pbz-amm": {
              command: dash?.cli_exe ?? "pbz-amm.exe",
              args: ["--data-dir", dash?.data_dir ?? "Data", "mcp", "serve"],
            },
          },
        },
        null,
        2
      ),
    [dash]
  );

  const conflictCount = dash?.conflict_messages.length ?? 0;
  const modCount = dash ? Object.keys(dash.mods).length : 0;

  const chapters: Array<{ id: NavTab; title: string; sub: string; badge?: number; warn?: boolean }> =
    [
      { id: "mods", title: "已装 Mod", sub: "启用开关 · 安装与版本回退", badge: modCount },
      {
        id: "diagnostics",
        title: "前置与冲突",
        sub: "框架检测 · 内部资产冲突排查",
        badge: conflictCount > 0 ? conflictCount : undefined,
        warn: conflictCount > 0,
      },
      {
        id: "nexus",
        title: "Nexus 工坊",
        sub: "在线搜索 · 检查已装更新",
        badge: nxUpdates.length > 0 ? nxUpdates.length : undefined,
        warn: nxUpdates.length > 0,
      },
      {
        id: "backups",
        title: "存档备份",
        sub: "自动快照 · 安全确认恢复",
        badge: dash?.save_backups.length ?? 0,
      },
      { id: "settings", title: "设置与接入", sub: "游戏目录 · Nexus 密钥 · MCP" },
    ];

  const activeChapter = chapters.find((c) => c.id === tab)!;

  return (
    <div
      className="wuxia-world"
      onMouseDown={() => {
        lastUserTouchRef.current = Date.now();
      }}
    >
      <SvgInkDefs />

      {/* Left Navigation Sidebar */}
      <aside className="chapter-sidebar">
        <div className="crest-header">
          <img src="/assets/seal-emblem.png" alt="PBZ-AMM" className="crest-emblem" />
          <div>
            <div className="crest-title-cn">PBZ-AMM</div>
            <div className="crest-sub">影之刃零 · Mod 管理器</div>
          </div>
        </div>

        <nav className="chapter-nav">
          {chapters.map((ch) => (
            <button
              key={ch.id}
              data-agent-id={`nav-${ch.id}`}
              className={`chapter-btn ${tab === ch.id ? "active" : ""}`}
              onClick={() => setTab(ch.id)}
            >
              <div>
                <span className="chapter-label-main">{ch.title}</span>
                <span className="chapter-label-sub">{ch.sub}</span>
              </div>
              {ch.badge !== undefined && (
                <span className={`wuxia-seal-tag ${ch.warn ? "crimson" : "gold"}`}>
                  {ch.badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: dash?.game ? "var(--bronze-bright)" : "#e88a8f" }}>
              {dash?.game ? `◆ 已连接 (${formatStore(dash.game.store)})` : "◇ 未绑定游戏目录"}
            </span>
            <button
              className="wuxia-btn-mini"
              onClick={() => void refreshDashboard()}
              disabled={busy}
              title="刷新本地与 CLI 最新状态"
            >
              <RefreshCw size={11} />
            </button>
          </div>
          <div className="mono" style={{ fontSize: 10.5, opacity: 0.68 }}>
            Apache-2.0 · CLI & GUI 共享核心
          </div>
        </div>
      </aside>

      {/* Main Content Stage */}
      <main className="stage-pane">
        <header className="stage-header">
          <div className="stage-title-group">
            <h1>{activeChapter.title}</h1>
            <span className="poetic-sub">{activeChapter.sub}</span>
          </div>

          <div className="waist-plaque-bar">
            <span style={{ fontSize: 12.5, color: "var(--parchment-dim)" }}>
              当前配置：
            </span>
            {sortedProfiles.map((p) => (
              <button
                key={p.id}
                data-agent-id={`profile:${p.id}`}
                className={`waist-plaque ${dash?.active_profile_id === p.id ? "active" : ""}`}
                disabled={busy || !dash?.game}
                onClick={async () => {
                  if (dash?.active_profile_id === p.id) return;
                  setBusy(true);
                  const env = await invoke<UiEnvelope>("cmd_switch_profile", { id: p.id });
                  setBusy(false);
                  if (env.status === "ok") {
                    notify(`已切换至「${p.display_name}」（游戏存档保持共用）`);
                    await refreshDashboard();
                  } else notify(env.error ?? "切换配置失败", true);
                }}
                title={p.description || p.display_name}
              >
                {p.display_name}
              </button>
            ))}
            <button
              data-agent-id="btn-new-profile"
              className="wuxia-btn"
              style={{ padding: "4px 11px" }}
              onClick={() => setShowNewProfile(true)}
            >
              <Plus size={13} />
              新建配置
            </button>
          </div>
        </header>

        <div className="stage-scroll">
          {dash && !dash.game && (
            <WuxiaPlaque variant="crimson">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
                <div>
                  <div style={{ fontWeight: 700, color: "#ffb0b4", marginBottom: 4 }}>
                    尚未定位《影之刃零》游戏目录
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--parchment-dim)" }}>
                    {dash.game_missing_reason ?? "请手动选择包含 ProjectPBZ 与 platform 文件夹的游戏安装根目录。"}
                  </div>
                </div>
                <button className="wuxia-btn gold" onClick={() => void handlePickGameDir()}>
                  <FolderSearch size={15} />
                  选择游戏目录
                </button>
              </div>
            </WuxiaPlaque>
          )}

          {/* TAB 1: MODS */}
          {tab === "mods" && (
            <>
              <div
                data-agent-id="dropzone"
                className={`ritual-dropzone ${pulsedKey === "[data-agent-id='dropzone']" ? "agent-pulse" : ""}`}
              >
                <div>
                  <div className="ritual-dropzone-title">拖入压缩包或文件夹即可安装</div>
                  <div style={{ fontSize: 12.5, color: "var(--parchment-dim)" }}>
                    支持 <span className="mono">.zip / .7z / .rar / .pak</span> 或解压目录；自动修正不同商店路径，遇到多选一版本或文件冲突时会自动停下供你确认。
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
                  <button
                    className="wuxia-btn primary-crimson"
                    disabled={busy || !dash?.game}
                    onClick={async () => {
                      const p = await invoke<string | null>("cmd_pick_mod_file");
                      if (p) await inspectPath(p);
                    }}
                  >
                    <PackagePlus size={15} />
                    选择压缩包
                  </button>
                  <button
                    className="wuxia-btn"
                    disabled={busy || !dash?.game}
                    onClick={async () => {
                      const p = await invoke<string | null>("cmd_pick_mod_folder");
                      if (p) await inspectPath(p);
                    }}
                  >
                    <FolderOpen size={15} />
                    选择文件夹
                  </button>
                </div>
              </div>

              {dash && dash.unmanaged.length > 0 && (
                <WuxiaPlaque variant="gold" agentId="wild-adopt-panel">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div>
                      <span style={{ fontWeight: 700, color: "var(--bronze-bright)" }}>
                        发现 {dash.unmanaged.length} 项手动安装的已有 Mod
                      </span>
                      <span style={{ marginLeft: 10, fontSize: 12, color: "var(--parchment-dim)" }}>
                        勾选后可纳入管理器统一开关与备份；未勾选的文件将保持原位不动。
                      </span>
                    </div>
                    <button
                      data-agent-id="btn-adopt-wild"
                      className="wuxia-btn gold"
                      disabled={busy || selectedWildIds.length === 0}
                      onClick={async () => {
                        setBusy(true);
                        const env = await invoke<UiEnvelope>("cmd_adopt_mods", { ids: selectedWildIds });
                        setBusy(false);
                        if (env.status === "ok") {
                          setSelectedWildIds([]);
                          notify("所选 Mod 已纳入管理");
                          await refreshDashboard();
                        } else notify(env.error ?? "纳入管理失败", true);
                      }}
                    >
                      纳入管理 ({selectedWildIds.length})
                    </button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {dash.unmanaged.map((u) => {
                      const checked = selectedWildIds.includes(u.id);
                      return (
                        <div key={u.id} className="variant-option-row">
                          <SealCheck
                            checked={checked}
                            onChange={(next) =>
                              setSelectedWildIds((prev) =>
                                next ? [...prev, u.id] : prev.filter((x) => x !== u.id)
                              )
                            }
                            label={
                              <span>
                                <strong>{u.name}</strong>{" "}
                                <span className="wuxia-seal-tag">{u.target}</span>
                              </span>
                            }
                          />
                          <span className="mono" style={{ color: "var(--parchment-muted)" }}>
                            {u.game_rel_paths[0]} ({formatBytes(u.total_bytes)})
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </WuxiaPlaque>
              )}

              <InkDivider label={`共安装 ${modCount} 个 Mod · 当前配置已启用 ${Array.from(enabledMap.values()).filter(Boolean).length} 个`} />

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <input
                  className="wuxia-input"
                  style={{ width: 280 }}
                  placeholder="搜索 Mod 名称 / ID / 类型..."
                  value={modFilter}
                  onChange={(e) => setModFilter(e.target.value)}
                />
              </div>

              {sortedMods.length === 0 ? (
                <WuxiaPlaque style={{ textAlign: "center", padding: "42px 24px" }}>
                  <img
                    src="/assets/seal-emblem.png"
                    alt=""
                    width={64}
                    height={64}
                    style={{ opacity: 0.42, marginBottom: 10 }}
                  />
                  <div style={{ fontSize: 14.5, color: "var(--parchment-dim)" }}>
                    暂未安装任何 Mod。可将下载好的压缩包直接拖入窗口，或前往「Nexus 工坊」搜索下载。
                  </div>
                </WuxiaPlaque>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {sortedMods.map((mod) => {
                    const isOn = enabledMap.get(mod.id) ?? false;
                    const hasUpdate =
                      mod.latest_remote_version &&
                      mod.latest_remote_version !== mod.current.version;
                    const rowSel = `[data-agent-id='mod-row:${mod.id}']`;
                    const swSel = `[data-agent-id='mod-switch:${mod.id}']`;
                    return (
                      <div
                        key={mod.id}
                        data-agent-id={`mod-row:${mod.id}`}
                        className={`mod-scroll-row ${isOn ? "" : "disabled"} ${
                          pulsedKey === rowSel || pulsedKey === swSel ? "agent-pulse" : ""
                        }`}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                          <LozengeSwitch
                            agentId={`mod-switch:${mod.id}`}
                            checked={isOn}
                            disabled={busy}
                            onChange={async () => {
                              setBusy(true);
                              const env = await invoke<UiEnvelope>("cmd_set_mod_enabled", {
                                modId: mod.id,
                                enabled: !isOn,
                              });
                              setBusy(false);
                              if (env.status === "ok") await refreshDashboard();
                              else notify(env.error ?? "切换状态失败", true);
                            }}
                            title={isOn ? "点击在当前配置中停用" : "点击在当前配置中启用"}
                          />
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ fontFamily: "var(--font-serif)", fontWeight: 700, fontSize: 15 }}>
                                {mod.name}
                              </span>
                              <span className="wuxia-seal-tag">v{mod.current.version}</span>
                              {mod.current.categories.map((cat) => (
                                <span key={cat} className="wuxia-seal-tag gold">
                                  {cat}
                                </span>
                              ))}
                              {mod.nexus_mod_id && (
                                <span className="wuxia-seal-tag jade">Nexus #{mod.nexus_mod_id}</span>
                              )}
                              {hasUpdate && (
                                <span className="wuxia-seal-tag crimson">
                                  可更新 v{mod.latest_remote_version}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 12, color: "var(--parchment-muted)", marginTop: 3 }}>
                              变体：{mod.current.variant_name} · {mod.current.files.length} 个文件
                              {mod.current.containers.length > 0 &&
                                ` · ${mod.current.containers.length} 个 Pak/IoStore 容器`}
                            </div>
                          </div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {mod.previous && (
                            <button
                              className="wuxia-btn"
                              disabled={busy}
                              onClick={async () => {
                                setBusy(true);
                                const env = await invoke<UiEnvelope>("cmd_rollback_mod", {
                                  modId: mod.id,
                                });
                                setBusy(false);
                                if (env.status === "ok") {
                                  notify(`已回退至上一版本 v${mod.previous!.version}`);
                                  await refreshDashboard();
                                } else notify(env.error ?? "回退失败", true);
                              }}
                            >
                              <RotateCcw size={13} />
                              回退 v{mod.previous.version}
                            </button>
                          )}
                          <button
                            className="wuxia-btn primary-crimson"
                            style={{ padding: "6px 10px" }}
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              const env = await invoke<UiEnvelope>("cmd_remove_mod", {
                                modId: mod.id,
                              });
                              setBusy(false);
                              if (env.status === "ok") {
                                notify(`已卸载：${mod.name}`);
                                await refreshDashboard();
                              } else notify(env.error ?? "卸载失败", true);
                            }}
                            title="卸载此 Mod"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* TAB 2: DIAGNOSTICS */}
          {tab === "diagnostics" && (
            <>
              <div className="grid-2">
                {[
                  {
                    name: "UE4SS 脚本框架 (PBZ 专用版)",
                    nxId: 13,
                    ok: dash?.frameworks?.ue4ss ?? false,
                    desc: "位于 platform/<store>/dwmapi.dll 及 ue4ss/Mods/，用于运行 Lua 与原生 C++ 功能 Mod。",
                  },
                  {
                    name: "Mods Menu (游戏内菜单框架)",
                    nxId: 149,
                    ok: dash?.frameworks?.mods_menu ?? false,
                    desc: "位于根目录 hid.dll 及 PBZModsMenu/Mods/，支持在游戏设置菜单或快捷键中直接开关 Mod。",
                  },
                  {
                    name: "PBZModLoader (JS 脚本加载器)",
                    nxId: 113,
                    ok: dash?.frameworks?.pbz_mod_loader ?? false,
                    desc: "位于 ProjectPBZ/PBZModLoader/mods/，注意 v2.0 起仅支持加载编译好的 .js 脚本。",
                  },
                  {
                    name: "CPP Pak Bypass (脚本包兼容补丁)",
                    nxId: 520,
                    ok: dash?.frameworks?.cpp_pak_bypass ?? false,
                    desc: "修复 11 月 4 日游戏更新后，包含 JavaScript 修改的 .pak 模组被拦截失效的问题。",
                  },
                  {
                    name: "PBZ Outfit Framework (独立服装框架)",
                    nxId: 903,
                    ok: dash?.frameworks?.outfit_framework ?? false,
                    desc: "支持新增独立服装栏位，避免多套外观 Mod 互相替换同一件原版服装。",
                  },
                ].map((fw) => (
                  <WuxiaPlaque key={fw.name} variant={fw.ok ? "gold" : "default"}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontFamily: "var(--font-serif)", fontWeight: 700 }}>
                        {fw.name}
                      </span>
                      <span className={`wuxia-seal-tag ${fw.ok ? "jade" : ""}`}>
                        {fw.ok ? "已安装" : "未安装"}
                      </span>
                    </div>
                    <p style={{ fontSize: 12, color: "var(--parchment-dim)", marginBottom: 10 }}>
                      {fw.desc}
                    </p>
                    <button
                      className="wuxia-btn"
                      style={{ padding: "4px 11px", fontSize: 12 }}
                      onClick={async () => {
                        setBusy(true);
                        const env = await invoke<UiEnvelope<NexusModDetailsData>>(
                          "cmd_nexus_mod_details",
                          { modId: fw.nxId }
                        );
                        setBusy(false);
                        if (env.status === "ok" && env.data) {
                          setNxDetails(env.data);
                          setTab("nexus");
                        }
                      }}
                    >
                      查看 Nexus #{fw.nxId}
                    </button>
                  </WuxiaPlaque>
                ))}

                <WuxiaPlaque>
                  <div style={{ fontFamily: "var(--font-serif)", fontWeight: 700, marginBottom: 6 }}>
                    代理注入 DLL 占用检测
                  </div>
                  <p style={{ fontSize: 12, color: "var(--parchment-dim)", marginBottom: 8 }}>
                    检测游戏目录中 <span className="mono">dwmapi / hid / version / winhttp</span> 等同名注入文件占用情况，防止冲突覆盖：
                  </p>
                  {dash?.frameworks?.occupied_proxy_dlls.length ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {dash.frameworks.occupied_proxy_dlls.map((dll) => (
                        <span key={dll} className="wuxia-seal-tag gold mono">
                          {dll}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span style={{ fontSize: 12, color: "var(--parchment-muted)" }}>
                      当前未检测到代理注入 DLL
                    </span>
                  )}
                </WuxiaPlaque>
              </div>

              <WuxiaPlaque
                agentId="conflict-audit-card"
                variant={conflictCount > 0 ? "crimson" : "gold"}
                highlighted={pulsedKey === "[data-agent-id='conflict-audit-card']"}
              >
                <div style={{ fontFamily: "var(--font-serif)", fontWeight: 700, marginBottom: 8 }}>
                  当前配置冲突检测（文件路径 + .pak / .utoc 内部资产与数据块）
                </div>
                {conflictCount === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--jade-bright)" }}>
                    ◆ 当前启用的 Mod 之间无任何文件或内部资产冲突。
                  </div>
                ) : (
                  <ul style={{ paddingLeft: 18, fontSize: 12.5, display: "grid", gap: 5 }}>
                    {dash?.conflict_messages.map((msg, i) => (
                      <li key={i} style={{ color: "#ffb0b4" }}>
                        {msg}
                      </li>
                    ))}
                  </ul>
                )}
              </WuxiaPlaque>
            </>
          )}

          {/* TAB 3: NEXUS */}
          {tab === "nexus" && (
            <>
              <NexusAuthPanel
                agentId="nexus-auth-guide"
                highlighted={pulsedKey === "[data-agent-id='nexus-auth-guide']"}
                hasKey={dash?.has_nexus_key ?? false}
                nxmRegistered={dash?.nxm_registered ?? false}
                account={nexusAccount}
                busy={busy}
                compactWhenBound
                useEmbeddedBrowser={useEmbeddedBrowser}
                onToggleEmbeddedBrowser={setUseEmbeddedBrowser}
                onOpenUrl={handleOpenUrl}
                onBindKey={handleBindNexusKey}
                onRegisterNxm={handleRegisterNxm}
                onClearKey={handleClearNexusKey}
              />

              {browserConfirmHint && (
                <WuxiaPlaque variant="gold">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <div style={{ fontSize: 12.5, color: "var(--bronze-bright)" }}>{browserConfirmHint}</div>
                    <button className="wuxia-btn-mini" onClick={() => setBrowserConfirmHint(null)}>
                      知道了
                    </button>
                  </div>
                </WuxiaPlaque>
              )}

              <WuxiaPlaque style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  data-agent-id="nexus-search-input"
                  className="wuxia-input"
                  style={{ flex: 1 }}
                  placeholder="免登录搜索 Nexus《影之刃零》Mod（如 QTE / Hold / Outfit，留空查看热门）..."
                  value={nxKeyword}
                  onChange={(e) => setNxKeyword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void runNexusSearch()}
                />
                <button
                  data-agent-id="btn-nexus-search"
                  className="wuxia-btn primary-crimson"
                  disabled={busy}
                  onClick={() => void runNexusSearch()}
                >
                  <Search size={14} />
                  搜索 Mod
                </button>
                <button
                  data-agent-id="btn-nexus-updates"
                  className="wuxia-btn gold"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    const env = await invoke<UiEnvelope<{ updates: UpdateEntry[] }>>(
                      "cmd_nexus_check_updates"
                    );
                    setBusy(false);
                    if (env.status === "ok" && env.data) {
                      setNxUpdates(env.data.updates);
                      notify(
                        env.data.updates.length > 0
                          ? `发现 ${env.data.updates.length} 个已装 Mod 有可用更新`
                          : "已关联 Nexus 的 Mod 均已是最新版本"
                      );
                      await refreshDashboard();
                    }
                  }}
                >
                  <Sparkles size={14} />
                  检查更新
                </button>
              </WuxiaPlaque>

              {nxDetails && (
                <WuxiaPlaque variant="gold">
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <div>
                      <div style={{ fontFamily: "var(--font-serif)", fontSize: 16, fontWeight: 700 }}>
                        {nxDetails.summary.name}{" "}
                        <span className="wuxia-seal-tag gold">#{nxDetails.summary.mod_id}</span>{" "}
                        <span className="wuxia-seal-tag">v{nxDetails.summary.version}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--parchment-dim)", marginTop: 2 }}>
                        作者：{nxDetails.summary.author} · 下载：{nxDetails.summary.downloads} 次 ·{" "}
                        <span className="mono">{nxDetails.summary.page_url}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        className="wuxia-btn"
                        disabled={busy}
                        onClick={() => void handleOpenUrl(nxDetails.summary.page_url)}
                      >
                        <ExternalLink size={14} />
                        打开网页
                      </button>
                      <button
                        className="wuxia-btn primary-crimson"
                        disabled={busy}
                        onClick={() => void handleDownloadAndInspect(nxDetails.summary.mod_id)}
                      >
                        <Download size={14} />
                        下载并安装
                      </button>
                      <button className="wuxia-btn" onClick={() => setNxDetails(null)}>
                        收起
                      </button>
                    </div>
                  </div>
                  <p style={{ fontSize: 12.5, marginBottom: 8 }}>{nxDetails.summary.summary}</p>
                  <div style={{ fontSize: 12, color: "var(--parchment-dim)" }}>
                    <strong>前置要求：</strong>
                    {nxDetails.requirements.length === 0
                      ? " 无额外前置依赖"
                      : nxDetails.requirements.map((r) => ` #${r.mod_id} ${r.name}`).join(" / ")}
                  </div>
                </WuxiaPlaque>
              )}

              <div className="grid-2">
                {nxResults.map((m) => (
                  <WuxiaPlaque
                    key={m.mod_id}
                    agentId={`nexus-card:${m.mod_id}`}
                    highlighted={pulsedKey === `[data-agent-id='nexus-card:${m.mod_id}']`}
                    style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}
                  >
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontFamily: "var(--font-serif)", fontWeight: 700 }}>
                          {m.name}
                        </span>
                        <span className="wuxia-seal-tag">v{m.version}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--parchment-muted)", marginBottom: 6 }}>
                        #{m.mod_id} · {m.author} · {m.downloads.toLocaleString()} 次下载
                        {m.category ? ` · ${m.category}` : ""}
                      </div>
                      <p
                        style={{
                          fontSize: 12.5,
                          color: "var(--parchment-dim)",
                          marginBottom: 12,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {m.summary || "暂无简介"}
                      </p>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className="wuxia-btn"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            const env = await invoke<UiEnvelope<NexusModDetailsData>>(
                              "cmd_nexus_mod_details",
                              { modId: m.mod_id }
                            );
                            setBusy(false);
                            if (env.status === "ok" && env.data) setNxDetails(env.data);
                          }}
                        >
                          详情与前置
                        </button>
                        <button
                          className="wuxia-btn"
                          disabled={busy}
                          onClick={() => void handleOpenUrl(m.page_url)}
                          title="在浏览器打开 Nexus 主页"
                        >
                          <ExternalLink size={13} />
                        </button>
                      </div>
                      <button
                        data-agent-id={`nexus-dl:${m.mod_id}`}
                        className="wuxia-btn gold"
                        disabled={busy}
                        onClick={() => void handleDownloadAndInspect(m.mod_id)}
                      >
                        <Download size={13} />
                        下载预检
                      </button>
                    </div>
                  </WuxiaPlaque>
                ))}
              </div>
            </>
          )}

          {/* TAB 4: BACKUPS */}
          {tab === "backups" && (
            <>
              <WuxiaPlaque variant="gold">
                <div style={{ fontFamily: "var(--font-serif)", fontWeight: 700, marginBottom: 10, color: "var(--bronze-bright)" }}>
                  手动备份当前游戏存档 (SaveGames)
                </div>
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    className="wuxia-input"
                    style={{ flex: 1, minWidth: 220 }}
                    placeholder="输入备份备注（如：挑战 Boss 前 / 安装新 Mod 前）..."
                    value={backupNote}
                    onChange={(e) => setBackupNote(e.target.value)}
                  />
                  <SealCheck
                    checked={backupPin}
                    onChange={setBackupPin}
                    label="永久保留（不被配额自动清理）"
                  />
                  <button
                    data-agent-id="btn-backup-create"
                    className="wuxia-btn primary-crimson"
                    disabled={busy || !dash?.game}
                    onClick={async () => {
                      setBusy(true);
                      const env = await invoke<UiEnvelope>("cmd_create_backup", {
                        note: backupNote.trim() || null,
                        pin: backupPin,
                      });
                      setBusy(false);
                      if (env.status === "ok") {
                        setBackupNote("");
                        setBackupPin(false);
                        notify("存档备份已完成（含 SHA-256 完整性校验）");
                        await refreshDashboard();
                      } else notify(env.error ?? "备份失败", true);
                    }}
                  >
                    <ArchiveRestore size={14} />
                    立即备份
                  </button>
                </div>
              </WuxiaPlaque>

              {dash?.save_backups.length === 0 ? (
                <WuxiaPlaque style={{ textAlign: "center", padding: "36px 20px", color: "var(--parchment-muted)" }}>
                  暂无存档备份。在首次安装、卸载或切换配置方案前，系统会自动为你创建防损快照。
                </WuxiaPlaque>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {dash?.save_backups.map((b) => (
                    <div key={b.id} data-agent-id={`backup-row:${b.id}`} className="mod-scroll-row">
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className="mono" style={{ fontWeight: 700 }}>
                            {b.id}
                          </span>
                          {b.pinned && <span className="wuxia-seal-tag gold">永久保留</span>}
                          <span className="wuxia-seal-tag">{b.trigger_reason}</span>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--parchment-dim)", marginTop: 3 }}>
                          {b.note ? `备注：${b.note} · ` : ""}
                          包含 {b.file_count} 个存档文件 · {formatBytes(b.size_bytes)} · SHA-256:{" "}
                          <span className="mono">{b.sha256.slice(0, 12)}...</span>
                        </div>
                      </div>

                      {confirmRestoreId === b.id ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 12, color: "#ffb0b4" }}>
                            确认覆盖当前存档？（请先退出游戏）
                          </span>
                          <button
                            className="wuxia-btn primary-crimson"
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              const env = await invoke<UiEnvelope>("cmd_restore_backup", {
                                backupId: b.id,
                                confirm: true,
                              });
                              setBusy(false);
                              if (env.status === "ok") {
                                setConfirmRestoreId(null);
                                notify("存档已安全恢复（恢复前状态已自动留底）");
                                await refreshDashboard();
                              } else notify(env.error ?? "恢复失败", true);
                            }}
                          >
                            确认恢复
                          </button>
                          <button className="wuxia-btn" onClick={() => setConfirmRestoreId(null)}>
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          className="wuxia-btn"
                          disabled={busy}
                          onClick={() => setConfirmRestoreId(b.id)}
                        >
                          恢复此备份
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* TAB 5: SETTINGS */}
          {tab === "settings" && (
            <>
              <WuxiaPlaque>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ fontFamily: "var(--font-serif)", fontWeight: 700 }}>
                    《影之刃零》游戏目录设置
                  </span>
                  <button className="wuxia-btn" onClick={() => void handlePickGameDir()}>
                    <FolderSearch size={14} />
                    重新选择目录
                  </button>
                </div>
                {dash?.game ? (
                  <div className="mono" style={{ display: "grid", gap: 5, color: "var(--parchment-dim)" }}>
                    <div>游戏根目录：{dash.game.root_dir}</div>
                    <div>主程序路径：{dash.game.shipping_exe}</div>
                    <div>Pak ~mods：{dash.game.tilde_mods_dir}</div>
                    <div>UE4SS 目录：{dash.game.ue4ss_mods_dir}</div>
                    <div>存档目录：{dash.game.save_games_dir}</div>
                  </div>
                ) : (
                  <div style={{ color: "var(--parchment-muted)" }}>尚未绑定游戏目录</div>
                )}
              </WuxiaPlaque>

              <NexusAuthPanel
                agentId="nexus-auth-card"
                highlighted={pulsedKey === "[data-agent-id='nexus-auth-card']"}
                hasKey={dash?.has_nexus_key ?? false}
                nxmRegistered={dash?.nxm_registered ?? false}
                account={nexusAccount}
                busy={busy}
                useEmbeddedBrowser={useEmbeddedBrowser}
                onToggleEmbeddedBrowser={setUseEmbeddedBrowser}
                onOpenUrl={handleOpenUrl}
                onBindKey={handleBindNexusKey}
                onRegisterNxm={handleRegisterNxm}
                onClearKey={handleClearNexusKey}
              />

              <WuxiaPlaque variant="gold">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontFamily: "var(--font-serif)", fontWeight: 700, color: "var(--bronze-bright)" }}>
                    CLI 命令行与 AI Agent (MCP) 接入配置
                  </span>
                  <button
                    className="wuxia-btn"
                    onClick={() => {
                      void navigator.clipboard.writeText(mcpSnippet);
                      setCopiedMcp(true);
                      window.setTimeout(() => setCopiedMcp(false), 2000);
                    }}
                  >
                    {copiedMcp ? <Check size={13} /> : <Copy size={13} />}
                    {copiedMcp ? "已复制" : "复制 MCP 配置"}
                  </button>
                </div>
                <p style={{ fontSize: 12, color: "var(--parchment-dim)", marginBottom: 8 }}>
                  共享数据目录：<span className="mono">{dash?.data_dir}</span>。通过命令行或 MCP 执行的操作会自动同步展示在桌面端界面中：
                </p>
                <pre className="manifest-code-box mono" style={{ color: "var(--bronze-bright)" }}>
                  {mcpSnippet}
                </pre>
              </WuxiaPlaque>
            </>
          )}
        </div>
      </main>

      {/* Inspect & Install Modal (Dual-End Sync Option A) */}
      {inspectData && (
        <InspectModal
          payload={inspectData.payload}
          busy={busy}
          triggeredByAgent={inspectData.triggeredByAgent}
          nexusIdOverride={inspectData.nexusId}
          versionOverride={inspectData.version}
          onClose={() => setInspectData(null)}
          onConfirmInstall={(opts) => void handleConfirmInstall(opts)}
        />
      )}

      {/* New Profile Modal */}
      {showNewProfile && (
        <div className="modal-backdrop" onClick={() => setShowNewProfile(false)}>
          <div className="modal-scroll-panel" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>新建 Mod 配置方案</h2>
            </div>
            <div className="modal-body">
              <input
                className="wuxia-input"
                placeholder="英文标识 ID（如 practice / outfits）"
                value={newProfId}
                onChange={(e) => setNewProfId(e.target.value)}
              />
              <input
                className="wuxia-input"
                placeholder="配置显示名称（如 练习模式 / 纯外观）"
                value={newProfName}
                onChange={(e) => setNewProfName(e.target.value)}
              />
              <input
                className="wuxia-input"
                placeholder="备注说明（可选）"
                value={newProfDesc}
                onChange={(e) => setNewProfDesc(e.target.value)}
              />
              <SealCheck
                checked={newProfClone}
                onChange={setNewProfClone}
                label="复制当前配置的 Mod 启用状态（游戏存档始终共用）"
              />
            </div>
            <div className="modal-footer">
              <button className="wuxia-btn" onClick={() => setShowNewProfile(false)}>
                取消
              </button>
              <button
                className="wuxia-btn primary-crimson"
                disabled={busy}
                onClick={async () => {
                  if (!newProfId.trim() || !newProfName.trim()) {
                    return notify("请填写英文标识 ID 与显示名称", true);
                  }
                  setBusy(true);
                  const env = await invoke<UiEnvelope>("cmd_create_profile", {
                    id: newProfId.trim(),
                    name: newProfName.trim(),
                    desc: newProfDesc.trim(),
                    cloneActive: newProfClone,
                  });
                  setBusy(false);
                  if (env.status === "ok") {
                    setShowNewProfile(false);
                    setNewProfId("");
                    setNewProfName("");
                    setNewProfDesc("");
                    notify("新配置方案已创建");
                    await refreshDashboard();
                  } else notify(env.error ?? "创建失败", true);
                }}
              >
                创建配置
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 1 + A: Clean Live Sync Status & Activity Drawer */}
      <PuppeteerOverlay activeBanner={activeBanner} events={activityLog} />

      {dragging && (
        <div className="drag-veil">
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "var(--font-serif)", fontSize: 24, fontWeight: 700, color: "var(--bronze-bright)" }}>
              松开鼠标以预检并安装 Mod
            </div>
            <div style={{ fontSize: 13.5, color: "var(--parchment-dim)", marginTop: 6 }}>
              自动检查压缩包结构、互斥可选版本与 .pak / .utoc 内部资产冲突
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast-scroll ${toast.isErr ? "err" : ""}`}>{toast.text}</div>}
    </div>
  );
}
