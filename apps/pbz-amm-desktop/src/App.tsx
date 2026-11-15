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
  KeyRound,
  PackagePlus,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { InspectModal } from "./components/InspectModal";
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

  const [backupNote, setBackupNote] = useState("");
  const [backupPin, setBackupPin] = useState(false);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);

  const [apiKeyInput, setApiKeyInput] = useState("");
  const [accountLabel, setAccountLabel] = useState<string | null>(null);
  const [copiedMcp, setCopiedMcp] = useState(false);

  // Puppeteer ("悬丝傀儡 · 无形执剑") live state
  const [activityLog, setActivityLog] = useState<AgentActivityEvent[]>([]);
  const [activeBanner, setActiveBanner] = useState<{
    actor: string;
    summary: string;
    phase: string;
  } | null>(null);
  const [cursorPos, setCursorPos] = useState<{
    x: number;
    y: number;
    striking: boolean;
  } | null>(null);
  const [ripples, setRipples] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const [pulsedKey, setPulsedKey] = useState<string | null>(null);

  const lastUserTouchRef = useRef<number>(0);
  const hideCursorTimerRef = useRef<number | null>(null);
  const tabRef = useRef<NavTab>(tab);
  tabRef.current = tab;

  const notify = useCallback((text: string, isErr = false) => {
    setToast({ text, isErr });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4600);
    return () => window.clearTimeout(t);
  }, [toast]);

  const spawnRipple = useCallback((x: number, y: number) => {
    const id = Date.now() + Math.random();
    setRipples((prev) => [...prev.slice(-6), { id, x, y }]);
    window.setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 720);
  }, []);

  const flyDaggerToSelector = useCallback(
    (selector: string, delayMs = 0) => {
      window.setTimeout(() => {
        const el = document.querySelector(selector) as HTMLElement | null;
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        const rect = el.getBoundingClientRect();
        const tx = Math.round(rect.left + Math.min(rect.width * 0.38, 90));
        const ty = Math.round(rect.top + rect.height * 0.52);
        setCursorPos({ x: tx, y: ty, striking: false });
        window.setTimeout(() => {
          setCursorPos({ x: tx, y: ty, striking: true });
          spawnRipple(tx, ty);
          window.setTimeout(() => {
            setCursorPos((cur) => (cur ? { ...cur, striking: false } : null));
          }, 210);
        }, 390);
      }, delayMs);
    },
    [spawnRipple]
  );

  const scheduleRetractPuppeteer = useCallback((ms = 3200) => {
    if (hideCursorTimerRef.current) {
      window.clearTimeout(hideCursorTimerRef.current);
    }
    hideCursorTimerRef.current = window.setTimeout(() => {
      setCursorPos(null);
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
      notify(`连接枢机核心异常：${String(e)}`, true);
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

  // Subscribe to live CLI / MCP Agent events!
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

      let stepDelay = 30;
      const nextTab = ev.tab_hint as NavTab | undefined;
      if (
        userIdle &&
        nextTab &&
        ["mods", "diagnostics", "nexus", "backups", "settings"].includes(nextTab) &&
        nextTab !== tabRef.current
      ) {
        flyDaggerToSelector(`[data-agent-id='nav-${nextTab}']`, 10);
        window.setTimeout(() => setTab(nextTab), 260);
        stepDelay = 480;
      }

      if (ev.target_selector) {
        flyDaggerToSelector(ev.target_selector, stepDelay);
        setPulsedKey(ev.target_selector);
      }

      // Sync live payload data into UI views
      const p = ev.payload;
      if (p) {
        if (typeof p.keyword === "string") {
          setNxKeyword(p.keyword);
        }
        if (Array.isArray(p.results)) {
          setNxResults(p.results);
          setNxLoadedOnce(true);
        }
        if (p.details?.summary) {
          setNxDetails(p.details);
        }
        if (Array.isArray(p.updates)) {
          setNxUpdates(p.updates);
        }
        // Option A: Auto-open InspectModal when CLI/MCP inspects or hits NeedsSelection!
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
        scheduleRetractPuppeteer(ev.phase === "needs_selection" ? 5500 : 3200);
      } else if (hideCursorTimerRef.current) {
        window.clearTimeout(hideCursorTimerRef.current);
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
  }, [flyDaggerToSelector, refreshDashboard, scheduleRetractPuppeteer]);

  const inspectPath = useCallback(
    async (path: string, nexusId?: number, version?: string) => {
      setBusy(true);
      try {
        const env = await invoke<UiEnvelope<InspectPayload>>("cmd_inspect_source", { path });
        if (env.status === "ok" && env.data) {
          setInspectData({ payload: env.data, nexusId, version });
        } else {
          notify(env.error ?? "拆封预检模组包失败", true);
        }
      } finally {
        setBusy(false);
      }
    },
    [notify]
  );

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
          notify(env.error ?? "藏经阁检索受阻", true);
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

  // Built-in choreography demo ("演武试剑")
  const handleRunShowcase = useCallback(() => {
    setActiveBanner({
      actor: "agent",
      summary: "演武试剑：巡检周天经脉 → 执卷检索藏经阁「QTE」",
      phase: "started",
    });
    flyDaggerToSelector("[data-agent-id='nav-diagnostics']", 20);
    window.setTimeout(() => setTab("diagnostics"), 340);
    window.setTimeout(() => {
      flyDaggerToSelector("[data-agent-id='conflict-audit-card']", 0);
    }, 820);
    window.setTimeout(() => {
      flyDaggerToSelector("[data-agent-id='nav-nexus']", 0);
      window.setTimeout(() => {
        setTab("nexus");
        setNxKeyword("QTE");
      }, 320);
    }, 1580);
    window.setTimeout(() => {
      flyDaggerToSelector("[data-agent-id='btn-nexus-search']", 0);
      void runNexusSearch("QTE");
      setActiveBanner({
        actor: "agent",
        summary: "演武礼成：已在藏经阁为你呈上「QTE」护手奇术",
        phase: "succeeded",
      });
      scheduleRetractPuppeteer(3000);
    }, 2350);
  }, [flyDaggerToSelector, runNexusSearch, scheduleRetractPuppeteer]);

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
        notify("已锁定《影之刃零》根基目录");
        await refreshDashboard();
      } else notify(env.error ?? "目录校验未过", true);
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
        notify("朱印已成 · 模组已入匣归位");
        await refreshDashboard();
      } else notify(env.error ?? "入匣受阻", true);
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadAndInspect = async (modId: number) => {
    setBusy(true);
    try {
      const env = await invoke<
        UiEnvelope<{ downloaded_path: string; nexus_mod_id: number; version: string }>
      >("cmd_nexus_download_stage", { modId });
      if (env.status === "ok" && env.data) {
        notify("卷宗已自藏经阁取回，正在展卷预检...");
        await inspectPath(env.data.downloaded_path, env.data.nexus_mod_id, env.data.version);
      } else {
        notify(
          env.error ??
            "免费账号无法静默直连：请在「枢机设置」中关联 nxm:// 后于网页点击 Mod Manager Download",
          true
        );
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
      { id: "mods", title: "剑匣 · 藏刃", sub: "硬链投递 · 鉴剑开关", badge: modCount },
      {
        id: "diagnostics",
        title: "玄机 · 经脉",
        sub: "前置探查 · 相冲审校",
        badge: conflictCount > 0 ? conflictCount : undefined,
        warn: conflictCount > 0,
      },
      {
        id: "nexus",
        title: "藏经阁 · 工坊",
        sub: "万卷搜罗 · 飞书取卷",
        badge: nxUpdates.length > 0 ? nxUpdates.length : undefined,
        warn: nxUpdates.length > 0,
      },
      {
        id: "backups",
        title: "残卷 · 溯时",
        sub: "存档封蜡 · 无损回魂",
        badge: dash?.save_backups.length ?? 0,
      },
      { id: "settings", title: "枢机 · 悬丝", sub: "密令金库 · 傀儡同核" },
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

      {/* Left Ink-Scroll Chapter Navigation */}
      <aside className="chapter-sidebar">
        <div className="vertical-motto">六十六日限 · 悬丝执万刃</div>

        <div className="crest-header">
          <img src="/assets/seal-emblem.png" alt="PBZ-AMM" className="crest-emblem" />
          <div>
            <div className="crest-title-cn">影刃枢机</div>
            <div className="crest-sub">PBZ · 悬丝模组匣</div>
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
              {dash?.game ? `◆ 已镇守 (${formatStore(dash.game.store)})` : "◇ 未寻获游戏根基"}
            </span>
            <button
              className="wuxia-btn-mini"
              onClick={() => void refreshDashboard()}
              disabled={busy}
              title="重巡磁盘与 CLI 同步态势"
            >
              <RefreshCw size={11} />
            </button>
          </div>
          <div className="mono" style={{ fontSize: 10.5, opacity: 0.68 }}>
            Apache-2.0 · 同核悬丝引擎
          </div>
        </div>
      </aside>

      {/* Main Stage */}
      <main className="stage-pane">
        <header className="stage-header">
          <div className="stage-title-group">
            <h1>{activeChapter.title}</h1>
            <span className="poetic-sub">「{activeChapter.sub}」</span>
          </div>

          <div className="waist-plaque-bar">
            <span style={{ fontFamily: "var(--font-kaiti)", color: "var(--parchment-dim)" }}>
              佩剑腰牌：
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
                    notify(`已易换腰牌至「${p.display_name}」（存档互通）`);
                    await refreshDashboard();
                  } else notify(env.error ?? "切换失败", true);
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
              铸牌
            </button>
          </div>
        </header>

        <div className="stage-scroll">
          {dash && !dash.game && (
            <WuxiaPlaque variant="crimson">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
                <div>
                  <div style={{ fontWeight: 700, color: "#ffb0b4", marginBottom: 4 }}>
                    尚未寻获《影之刃零》根基目录
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--parchment-dim)" }}>
                    {dash.game_missing_reason ?? "请手动指引包含 ProjectPBZ 与 platform 的安装目录。"}
                  </div>
                </div>
                <button className="wuxia-btn gold" onClick={() => void handlePickGameDir()}>
                  <FolderSearch size={15} />
                  指引山门目录
                </button>
              </div>
            </WuxiaPlaque>
          )}

          {/* CHAPTER 1: MODS */}
          {tab === "mods" && (
            <>
              <div
                data-agent-id="dropzone"
                className={`ritual-dropzone ${pulsedKey === "[data-agent-id='dropzone']" ? "agent-pulse" : ""}`}
              >
                <div>
                  <div className="ritual-dropzone-title">引卷入匣 · 悬丝自动鉴剑</div>
                  <div style={{ fontSize: 12.5, color: "var(--parchment-dim)" }}>
                    将 <span className="mono">.zip / .7z / .rar / .pak</span> 或目录直接拖入窗内；跨商店路径自动归正，遇多式变体或容器相冲必先呈报少侠定夺。
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
                    择选压缩卷
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
                    择选文件夹
                  </button>
                </div>
              </div>

              {dash && dash.unmanaged.length > 0 && (
                <WuxiaPlaque variant="gold" agentId="wild-adopt-panel">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div>
                      <span style={{ fontWeight: 700, color: "var(--bronze-bright)" }}>
                        察觉 {dash.unmanaged.length} 件散落江湖的野生模组
                      </span>
                      <span style={{ marginLeft: 10, fontSize: 12, color: "var(--parchment-dim)" }}>
                        朱印点选后可收归剑匣统一调遣；未点选之物分毫不犯。
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
                          notify("散落模组已收归剑匣");
                          await refreshDashboard();
                        } else notify(env.error ?? "收归失败", true);
                      }}
                    >
                      收归剑匣 ({selectedWildIds.length})
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

              <InkDivider label={`匣内藏刃 ${modCount} 具 · 当前已佩 ${Array.from(enabledMap.values()).filter(Boolean).length} 具`} />

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <input
                  className="wuxia-input"
                  style={{ width: 280 }}
                  placeholder="按名号 / 标识 / 流派检索匣内藏刃..."
                  value={modFilter}
                  onChange={(e) => setModFilter(e.target.value)}
                />
              </div>

              {sortedMods.length === 0 ? (
                <WuxiaPlaque style={{ textAlign: "center", padding: "42px 24px" }}>
                  <img
                    src="/assets/seal-emblem.png"
                    alt=""
                    width={68}
                    height={68}
                    style={{ opacity: 0.45, marginBottom: 10 }}
                  />
                  <div style={{ fontFamily: "var(--font-kaiti)", fontSize: 16, color: "var(--parchment-dim)" }}>
                    剑匣空寂，寒芒待铸。可将模组压缩卷直接拖入窗内，或赴「藏经阁」寻觅奇术。
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
                              else notify(env.error ?? "拨印失败", true);
                            }}
                            title={isOn ? "点击封匣停用" : "点击佩剑启用"}
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
                                <span className="wuxia-seal-tag jade">#{mod.nexus_mod_id}</span>
                              )}
                              {hasUpdate && (
                                <span className="wuxia-seal-tag crimson">
                                  新卷 v{mod.latest_remote_version}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 12, color: "var(--parchment-muted)", marginTop: 3 }}>
                              剑式：{mod.current.variant_name} · {mod.current.files.length} 件文件
                              {mod.current.containers.length > 0 &&
                                ` · ${mod.current.containers.length} 具 Pak/IoStore 容器`}
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
                                  notify(`已逆转机括回退至 v${mod.previous!.version}`);
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
                                notify(`已自剑匣除名：「${mod.name}」`);
                                await refreshDashboard();
                              } else notify(env.error ?? "除名失败", true);
                            }}
                            title="移出剑匣"
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

          {/* CHAPTER 2: DIAGNOSTICS */}
          {tab === "diagnostics" && (
            <>
              <div className="grid-2">
                {[
                  {
                    name: "UE4SS · 底层玄机",
                    nxId: 13,
                    ok: dash?.frameworks?.ue4ss ?? false,
                    desc: "驻守 platform/<store>/dwmapi.dll 及 ue4ss/Mods/，承载 Lua 与原生 C++ 奇术。",
                  },
                  {
                    name: "Mods Menu · 快捷法坛",
                    nxId: 149,
                    ok: dash?.frameworks?.mods_menu ?? false,
                    desc: "驻守根目录 hid.dll 及 PBZModsMenu/Mods/，游戏内直调诸般心法开关。",
                  },
                  {
                    name: "PBZModLoader · 破界引",
                    nxId: 113,
                    ok: dash?.frameworks?.pbz_mod_loader ?? false,
                    desc: "驻守 ProjectPBZ/PBZModLoader/mods/，v2.0 起专司加载预编译 .js 卷宗。",
                  },
                  {
                    name: "CPP Pak Bypass · 破禁令",
                    nxId: 520,
                    ok: dash?.frameworks?.cpp_pak_bypass ?? false,
                    desc: "化解 11 月 4 日补丁对含 JavaScript 脚本 .pak 模组的挂载封锁。",
                  },
                  {
                    name: "Outfit Framework · 锦衣匣",
                    nxId: 903,
                    ok: dash?.frameworks?.outfit_framework ?? false,
                    desc: "开辟独立华服槽位，免除多套外观争抢同一件原版衣裳之苦。",
                  },
                ].map((fw) => (
                  <WuxiaPlaque key={fw.name} variant={fw.ok ? "gold" : "default"}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontFamily: "var(--font-serif)", fontWeight: 700 }}>
                        {fw.name}
                      </span>
                      <span className={`wuxia-seal-tag ${fw.ok ? "jade" : ""}`}>
                        {fw.ok ? "脉络已通" : "未筑基"}
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
                      调阅藏经阁 #{fw.nxId}
                    </button>
                  </WuxiaPlaque>
                ))}

                <WuxiaPlaque>
                  <div style={{ fontFamily: "var(--font-serif)", fontWeight: 700, marginBottom: 6 }}>
                    注入门户 DLL 占用监察
                  </div>
                  <p style={{ fontSize: 12, color: "var(--parchment-dim)", marginBottom: 8 }}>
                    巡视 <span className="mono">dwmapi / hid / version / winhttp</span> 门户，严防两路加载器暗中覆压：
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
                      诸门清净，尚无代理注入 DLL 驻留
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
                  周天冲突审校（物理路径 + .pak / .utoc 虚拟资产与 ChunkId）
                </div>
                {conflictCount === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--jade-bright)" }}>
                    ◆ 诸刃各安其位，未见任何文件路径或容器内部资产相冲。
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

          {/* CHAPTER 3: NEXUS */}
          {tab === "nexus" && (
            <>
              <WuxiaPlaque style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  data-agent-id="nexus-search-input"
                  className="wuxia-input"
                  style={{ flex: 1 }}
                  placeholder="免密令直搜藏经阁《影之刃零》卷宗（如 QTE / Hold / Outfit，留空览热榜）..."
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
                  执卷检索
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
                          ? `察得 ${env.data.updates.length} 卷藏品有新版问世`
                          : "匣内关联藏品皆为最新之境"
                      );
                      await refreshDashboard();
                    }
                  }}
                >
                  <Sparkles size={14} />
                  查验新卷
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
                        铸卷人：{nxDetails.summary.author} · 传阅：{nxDetails.summary.downloads} 次 ·{" "}
                        <span className="mono">{nxDetails.summary.page_url}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        className="wuxia-btn primary-crimson"
                        disabled={busy}
                        onClick={() => void handleDownloadAndInspect(nxDetails.summary.mod_id)}
                      >
                        <Download size={14} />
                        取卷入匣
                      </button>
                      <button className="wuxia-btn" onClick={() => setNxDetails(null)}>
                        合卷
                      </button>
                    </div>
                  </div>
                  <p style={{ fontSize: 12.5, marginBottom: 8 }}>{nxDetails.summary.summary}</p>
                  <div style={{ fontSize: 12, color: "var(--parchment-dim)" }}>
                    <strong>前置根基：</strong>
                    {nxDetails.requirements.length === 0
                      ? " 无须额外前置，单卷可成"
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
                        #{m.mod_id} · {m.author} · {m.downloads.toLocaleString()} 传阅
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
                        {m.summary || "铸卷人未留题记"}
                      </p>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
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
                        <ExternalLink size={13} />
                        详录与前置
                      </button>
                      <button
                        data-agent-id={`nexus-dl:${m.mod_id}`}
                        className="wuxia-btn gold"
                        disabled={busy}
                        onClick={() => void handleDownloadAndInspect(m.mod_id)}
                      >
                        <Download size={13} />
                        取卷预检
                      </button>
                    </div>
                  </WuxiaPlaque>
                ))}
              </div>
            </>
          )}

          {/* CHAPTER 4: BACKUPS */}
          {tab === "backups" && (
            <>
              <WuxiaPlaque variant="gold">
                <div style={{ fontFamily: "var(--font-serif)", fontWeight: 700, marginBottom: 10, color: "var(--bronze-bright)" }}>
                  封存当前 SaveGames 命盘残卷
                </div>
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    className="wuxia-input"
                    style={{ flex: 1, minWidth: 220 }}
                    placeholder="题写封蜡铭文（如：决战荒城前 / 换装大修前）..."
                    value={backupNote}
                    onChange={(e) => setBackupNote(e.target.value)}
                  />
                  <SealCheck
                    checked={backupPin}
                    onChange={setBackupPin}
                    label="铁券永固（免于轮转清理）"
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
                        notify("SaveGames 残卷已封蜡并刻入 SHA-256 金印");
                        await refreshDashboard();
                      } else notify(env.error ?? "封存失败", true);
                    }}
                  >
                    <ArchiveRestore size={14} />
                    立封残卷
                  </button>
                </div>
              </WuxiaPlaque>

              {dash?.save_backups.length === 0 ? (
                <WuxiaPlaque style={{ textAlign: "center", padding: "36px 20px", color: "var(--parchment-muted)" }}>
                  尚无封蜡残卷。每次首次铸装、卸载或易换腰牌前，枢机皆会自动为你留存命盘快照。
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
                          {b.pinned && <span className="wuxia-seal-tag gold">铁券永固</span>}
                          <span className="wuxia-seal-tag">{b.trigger_reason}</span>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--parchment-dim)", marginTop: 3 }}>
                          {b.note ? `铭文：${b.note} · ` : ""}
                          内含 {b.file_count} 枚存档 · {formatBytes(b.size_bytes)} · 金印:{" "}
                          <span className="mono">{b.sha256.slice(0, 12)}...</span>
                        </div>
                      </div>

                      {confirmRestoreId === b.id ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 12, color: "#ffb0b4" }}>
                            确认覆写当前存档？（请务必先退出游戏）
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
                                notify("命盘残卷已安全回溯");
                                await refreshDashboard();
                              } else notify(env.error ?? "回溯失败", true);
                            }}
                          >
                            朱印准奏
                          </button>
                          <button className="wuxia-btn" onClick={() => setConfirmRestoreId(null)}>
                            罢手
                          </button>
                        </div>
                      ) : (
                        <button
                          className="wuxia-btn"
                          disabled={busy}
                          onClick={() => setConfirmRestoreId(b.id)}
                        >
                          溯回此卷
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* CHAPTER 5: SETTINGS */}
          {tab === "settings" && (
            <>
              <WuxiaPlaque>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ fontFamily: "var(--font-serif)", fontWeight: 700 }}>
                    《影之刃零》山门路径脉络
                  </span>
                  <button className="wuxia-btn" onClick={() => void handlePickGameDir()}>
                    <FolderSearch size={14} />
                    重指山门
                  </button>
                </div>
                {dash?.game ? (
                  <div className="mono" style={{ display: "grid", gap: 5, color: "var(--parchment-dim)" }}>
                    <div>游戏根基：{dash.game.root_dir}</div>
                    <div>真身主程：{dash.game.shipping_exe}</div>
                    <div>Pak ~mods：{dash.game.tilde_mods_dir}</div>
                    <div>UE4SS 坛：{dash.game.ue4ss_mods_dir}</div>
                    <div>命盘存档：{dash.game.save_games_dir}</div>
                  </div>
                ) : (
                  <div style={{ color: "var(--parchment-muted)" }}>尚未锁定游戏目录</div>
                )}
              </WuxiaPlaque>

              <WuxiaPlaque agentId="nexus-auth-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <KeyRound size={15} color="#d9b477" />
                    <span style={{ fontFamily: "var(--font-serif)", fontWeight: 700 }}>
                      藏经阁密令金库与 nxm:// 飞书协议
                    </span>
                  </div>
                  <span className={`wuxia-seal-tag ${dash?.has_nexus_key ? "jade" : ""}`}>
                    {accountLabel ?? (dash?.has_nexus_key ? "密令已锁入系统凭据库" : "未纳密令")}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: "var(--parchment-dim)", marginBottom: 10 }}>
                  Personal API Key 仅密存于 Windows 系统凭据管理器，绝不落明文。会员可静默直取卷宗；免费账号点「仅刻写 nxm://」后即可从浏览器唤起本枢机接引下载。
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    type="password"
                    className="wuxia-input"
                    style={{ flex: 1, minWidth: 220 }}
                    placeholder="粘贴 Nexus Personal API Key..."
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                  />
                  <button
                    className="wuxia-btn gold"
                    disabled={busy}
                    onClick={async () => {
                      if (!apiKeyInput.trim()) return notify("请先置入有效密令", true);
                      setBusy(true);
                      const env = await invoke<
                        UiEnvelope<{ account?: { name: string; is_premium: boolean } }>
                      >("cmd_nexus_auth", {
                        apiKey: apiKeyInput.trim(),
                        clear: false,
                        registerNxm: true,
                      });
                      setBusy(false);
                      if (env.status === "ok" && env.data?.account) {
                        setApiKeyInput("");
                        const acc = env.data.account;
                        setAccountLabel(`${acc.name} (${acc.is_premium ? "Premium" : "Free"})`);
                        notify(`密令已验明（${acc.name}），并刻妥 nxm:// 飞书协议`);
                        await refreshDashboard();
                      } else notify(env.error ?? "密令未过", true);
                    }}
                  >
                    验印入库并刻协议
                  </button>
                  <button
                    className="wuxia-btn"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      const env = await invoke<UiEnvelope>("cmd_nexus_auth", {
                        apiKey: null,
                        clear: false,
                        registerNxm: true,
                      });
                      setBusy(false);
                      if (env.status === "ok") notify("已刻写当前用户 nxm:// 协议");
                      else notify(env.error ?? "刻写失败", true);
                    }}
                  >
                    仅刻写 nxm://
                  </button>
                  {dash?.has_nexus_key && (
                    <button
                      className="wuxia-btn primary-crimson"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        await invoke("cmd_nexus_auth", { apiKey: null, clear: true, registerNxm: false });
                        setBusy(false);
                        setAccountLabel(null);
                        notify("已焚毁凭据库中之密令");
                        await refreshDashboard();
                      }}
                    >
                      焚毁密令
                    </button>
                  )}
                </div>
              </WuxiaPlaque>

              <WuxiaPlaque variant="gold">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontFamily: "var(--font-serif)", fontWeight: 700, color: "var(--bronze-bright)" }}>
                    悬丝傀儡 · CLI 与 AI Agent (MCP) 同核敕令配置
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
                    {copiedMcp ? "已拓印" : "拓印 MCP 配置"}
                  </button>
                </div>
                <p style={{ fontSize: 12, color: "var(--parchment-dim)", marginBottom: 8 }}>
                  共享数据仓：<span className="mono">{dash?.data_dir}</span>。凡由命令行或 MCP 发出之检索、鉴剑、开关、封存指令，本界面皆以「悬丝剑指」实时同步演武：
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
              <h2>镌刻新佩剑腰牌</h2>
            </div>
            <div className="modal-body">
              <input
                className="wuxia-input"
                placeholder="腰牌英文标识（如 practice / outfits）"
                value={newProfId}
                onChange={(e) => setNewProfId(e.target.value)}
              />
              <input
                className="wuxia-input"
                placeholder="腰牌名号（如 试剑练刀 / 锦衣夜行）"
                value={newProfName}
                onChange={(e) => setNewProfName(e.target.value)}
              />
              <input
                className="wuxia-input"
                placeholder="题铭备注（可选）"
                value={newProfDesc}
                onChange={(e) => setNewProfDesc(e.target.value)}
              />
              <SealCheck
                checked={newProfClone}
                onChange={setNewProfClone}
                label="承袭当前腰牌已佩之刃（命盘存档始终互通）"
              />
            </div>
            <div className="modal-footer">
              <button className="wuxia-btn" onClick={() => setShowNewProfile(false)}>
                罢手
              </button>
              <button
                className="wuxia-btn primary-crimson"
                disabled={busy}
                onClick={async () => {
                  if (!newProfId.trim() || !newProfName.trim()) {
                    return notify("请赐予腰牌标识与名号", true);
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
                    notify("新腰牌已镌刻完备");
                    await refreshDashboard();
                  } else notify(env.error ?? "镌刻失败", true);
                }}
              >
                落锤成牌
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2 + A Puppeteer Live Overlay */}
      <PuppeteerOverlay
        activeBanner={activeBanner}
        cursorPos={cursorPos}
        ripples={ripples}
        events={activityLog}
        onRunShowcase={handleRunShowcase}
      />

      {dragging && (
        <div className="drag-veil">
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "var(--font-calligraphy)", fontSize: 34, color: "var(--bronze-bright)" }}>
              释卷入阵 · 悬丝鉴剑
            </div>
            <div style={{ fontFamily: "var(--font-kaiti)", fontSize: 15, color: "var(--parchment-dim)", marginTop: 6 }}>
              自动审校压缩卷宗、多式剑招与 .pak / .utoc 容器资产相冲
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast-scroll ${toast.isErr ? "err" : ""}`}>{toast.text}</div>}
    </div>
  );
}
