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
  Languages,
  Moon,
  PackagePlus,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Sun,
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
import { formatProfileName, formatStoreName, MESSAGES, UiLang } from "./i18n";
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

export default function App() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      return localStorage.getItem("pbz_amm_theme") === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  const [lang, setLang] = useState<UiLang>(() => {
    try {
      return localStorage.getItem("pbz_amm_lang") === "en" ? "en" : "zh";
    } catch {
      return "zh";
    }
  });
  const msg = MESSAGES[lang];
  const msgRef = useRef(msg);
  msgRef.current = msg;
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
  const [useEmbeddedBrowser, setUseEmbeddedBrowser] = useState<boolean>(() => {
    try {
      return localStorage.getItem("pbz_amm_embedded_browser") === "1";
    } catch {
      return false;
    }
  });
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
  const busyRef = useRef<boolean>(busy);
  busyRef.current = busy;
  const authAttemptedRef = useRef<boolean>(false);

  const notify = useCallback((text: string, isErr = false) => {
    setToast({ text, isErr });
  }, []);

  const withBusy = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("pbz_amm_embedded_browser", useEmbeddedBrowser ? "1" : "0");
    } catch {
      // ignore storage failure
    }
  }, [useEmbeddedBrowser]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("pbz_amm_theme", theme);
    } catch {
      // ignore storage failure
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
    document.title = MESSAGES[lang].docTitle;
    try {
      localStorage.setItem("pbz_amm_lang", lang);
    } catch {
      // ignore storage failure
    }
  }, [lang]);

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
      notify(msgRef.current.toasts.readDashFailed(String(e)), true);
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
    let cancelled = false;
    let unAct: (() => void) | undefined;
    let unState: (() => void) | undefined;

    listen<AgentActivityEvent>("amm://activity", (e) => {
      const ev = e.payload;
      setActivityLog((prev) => (prev.some((x) => x.id === ev.id) ? prev : [...prev.slice(-59), ev]));
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
        const selector = ev.target_selector;
        setPulsedKey(selector);
        window.setTimeout(() => {
          try {
            const el = document.querySelector(selector) as HTMLElement | null;
            el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          } catch {
            // ignore invalid selector from external input
          }
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
      if (cancelled) fn();
      else unAct = fn;
    });

    listen("amm://state-changed", () => {
      void refreshDashboard();
    }).then((fn) => {
      if (cancelled) fn();
      else unState = fn;
    });

    return () => {
      cancelled = true;
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
          notify(env.error ?? msgRef.current.toasts.inspectFailed, true);
        }
      } finally {
        setBusy(false);
      }
    },
    [notify]
  );

  // Listen for in-app embedded Nexus browser / Downloads watcher completions
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let cancelled = false;
    let unDl: (() => void) | undefined;
    let unEvt: (() => void) | undefined;

    listen<{ path: string; nexus_mod_id?: number | null; version?: string | null }>(
      "amm://nexus-downloaded",
      (e) => {
        setBrowserConfirmHint(null);
        notify(msgRef.current.toasts.downloadedOpeningInspect);
        void inspectPath(
          e.payload.path,
          e.payload.nexus_mod_id ?? undefined,
          e.payload.version ?? undefined
        );
      }
    ).then((fn) => {
      if (cancelled) fn();
      else unDl = fn;
    });

    listen<{ kind: string; message?: string; mod_id?: number }>(
      "amm://nexus-browser-event",
      (e) => {
        if (e.payload.kind === "nxm_started") {
          notify(msgRef.current.toasts.nxmCaptured);
        } else if (e.payload.kind === "http_started") {
          notify(msgRef.current.toasts.embeddedDlStarted);
        } else if (e.payload.kind === "error") {
          notify(e.payload.message ?? msgRef.current.toasts.embeddedDlFailed, true);
        }
      }
    ).then((fn) => {
      if (cancelled) fn();
      else unEvt = fn;
    });

    return () => {
      cancelled = true;
      if (unDl) unDl();
      if (unEvt) unEvt();
    };
  }, [inspectPath, notify]);

  // Native window drag & drop
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "enter" || p.type === "over") {
          setDragging(true);
        } else if (p.type === "drop") {
          setDragging(false);
          if (!busyRef.current && p.paths.length > 0) void inspectPath(p.paths[0]);
        } else {
          setDragging(false);
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
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
          notify(env.error ?? msgRef.current.toasts.nexusSearchFailed, true);
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
      authAttemptedRef.current = false;
      setNexusAccount(null);
      return;
    }
    if (nexusAccount || authAttemptedRef.current) return;
    authAttemptedRef.current = true;
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
        notify(msgRef.current.toasts.gameDirBound);
        await refreshDashboard();
      } else notify(env.error ?? msgRef.current.toasts.gameDirInvalid, true);
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
        notify(msgRef.current.toasts.modInstalled);
        await refreshDashboard();
      } else notify(env.error ?? msgRef.current.toasts.installFailed, true);
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
        notify(env.error ?? msgRef.current.toasts.openBrowserFailed, true);
      }
    },
    [notify, useEmbeddedBrowser]
  );

  const handleBindNexusKey = useCallback(
    async (rawKey: string): Promise<boolean> => {
      const key = rawKey.trim();
      if (!key) {
        notify(msgRef.current.toasts.pasteNexusKey, true);
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
          notify(msgRef.current.toasts.nexusBound(acc.name, acc.is_premium));
          await refreshDashboard();
          return true;
        }
        notify(env.error ?? msgRef.current.toasts.keyVerifyFailed, true);
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
        notify(msgRef.current.toasts.nxmRegistered);
        await refreshDashboard();
      } else {
        notify(env.error ?? msgRef.current.toasts.registerFailed, true);
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
      notify(msgRef.current.toasts.keyCleared);
      await refreshDashboard();
    } finally {
      setBusy(false);
    }
  }, [notify, refreshDashboard]);

  const handleDownloadAndInspect = async (modId: number) => {
    if (!dash?.has_nexus_key) {
      setTab("nexus");
      setPulsedKey("[data-agent-id='nexus-auth-guide']");
      notify(msgRef.current.toasts.needNexusKeyFirst, true);
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
            setBrowserConfirmHint(msgRef.current.toasts.hintEmbedded(modId));
            notify(msgRef.current.toasts.clickSlowInEmbedded);
          } else {
            setBrowserConfirmHint(
              msgRef.current.toasts.hintSystemBrowser(modId, env.data.watch_dir)
            );
            notify(msgRef.current.toasts.openedInSystemBrowser);
          }
        } else if (env.data.downloaded_path) {
          notify(msgRef.current.toasts.downloadedOpeningInspect);
          await inspectPath(env.data.downloaded_path, env.data.nexus_mod_id, env.data.version);
        }
      } else if (env.status === "blocked") {
        setBrowserConfirmHint(msgRef.current.toasts.hintBlocked);
        notify(msgRef.current.toasts.clickSlowConfirm);
        await refreshDashboard();
      } else {
        notify(env.error ?? msgRef.current.toasts.downloadFailed, true);
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
      { id: "mods", ...msg.tabs.mods, badge: modCount },
      {
        id: "diagnostics",
        ...msg.tabs.diagnostics,
        badge: conflictCount > 0 ? conflictCount : undefined,
        warn: conflictCount > 0,
      },
      {
        id: "nexus",
        ...msg.tabs.nexus,
        badge: nxUpdates.length > 0 ? nxUpdates.length : undefined,
        warn: nxUpdates.length > 0,
      },
      {
        id: "backups",
        ...msg.tabs.backups,
        badge: dash?.save_backups.length ?? 0,
      },
      { id: "settings", ...msg.tabs.settings },
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
            <div className="crest-sub">{msg.sidebar.appSub}</div>
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
            <span style={{ color: dash?.game ? "var(--bronze-bright)" : "var(--cinnabar-text)" }}>
              {dash?.game
                ? msg.sidebar.connected(formatStoreName(dash.game.store, lang))
                : msg.sidebar.gameNotBound}
            </span>
            <button
              className="wuxia-btn-mini"
              onClick={() => void refreshDashboard()}
              disabled={busy}
              title={msg.sidebar.refreshTitle}
            >
              <RefreshCw size={11} />
            </button>
          </div>
          <div className="mono" style={{ fontSize: 10.5, opacity: 0.68 }}>
            {msg.sidebar.footerTag}
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
              {msg.header.currentProfile}
            </span>
            {sortedProfiles.map((p) => {
              const pName = formatProfileName(p.id, p.display_name, lang);
              return (
                <button
                  key={p.id}
                  data-agent-id={`profile:${p.id}`}
                  className={`waist-plaque ${dash?.active_profile_id === p.id ? "active" : ""}`}
                  disabled={busy || !dash?.game}
                  onClick={() => {
                    if (dash?.active_profile_id === p.id) return;
                    void withBusy(async () => {
                      const env = await invoke<UiEnvelope>("cmd_switch_profile", { id: p.id });
                      if (env.status === "ok") {
                        notify(msgRef.current.toasts.switchedProfile(pName));
                        await refreshDashboard();
                      } else notify(env.error ?? msgRef.current.toasts.switchProfileFailed, true);
                    });
                  }}
                  title={lang === "en" ? pName : p.description || pName}
                >
                  {pName}
                </button>
              );
            })}
            <button
              data-agent-id="btn-new-profile"
              className="wuxia-btn"
              style={{ padding: "4px 11px" }}
              onClick={() => setShowNewProfile(true)}
            >
              <Plus size={13} />
              {msg.header.newProfile}
            </button>
            <div className="theme-switch-pill" role="group" aria-label={msg.header.themeAria}>
              <button
                type="button"
                className={`theme-pill-btn ${theme === "dark" ? "active" : ""}`}
                onClick={() => setTheme("dark")}
                title={msg.header.themeDarkTitle}
              >
                <Moon size={12} />
                {msg.header.themeDark}
              </button>
              <button
                type="button"
                className={`theme-pill-btn ${theme === "light" ? "active" : ""}`}
                onClick={() => setTheme("light")}
                title={msg.header.themeLightTitle}
              >
                <Sun size={12} />
                {msg.header.themeLight}
              </button>
            </div>
            <div className="theme-switch-pill" role="group" aria-label={msg.header.langAria}>
              <button
                type="button"
                data-agent-id="btn-lang-zh"
                className={`theme-pill-btn ${lang === "zh" ? "active" : ""}`}
                onClick={() => setLang("zh")}
                title={msg.header.langZhTitle}
              >
                <Languages size={12} />
                中文
              </button>
              <button
                type="button"
                data-agent-id="btn-lang-en"
                className={`theme-pill-btn ${lang === "en" ? "active" : ""}`}
                onClick={() => setLang("en")}
                title={msg.header.langEnTitle}
              >
                EN
              </button>
            </div>
          </div>
        </header>

        <div className="stage-scroll">
          {dash && !dash.game && (
            <WuxiaPlaque variant="crimson">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
                <div>
                  <div style={{ fontWeight: 700, color: "var(--cinnabar-text)", marginBottom: 4 }}>
                    {msg.mods.gameMissingTitle}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--parchment-dim)" }}>
                    {dash.game_missing_reason ?? msg.mods.gameMissingFallback}
                  </div>
                </div>
                <button className="wuxia-btn gold" onClick={() => void handlePickGameDir()}>
                  <FolderSearch size={15} />
                  {msg.mods.pickGameDir}
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
                  <div className="ritual-dropzone-title">{msg.mods.dropzoneTitle}</div>
                  <div style={{ fontSize: 12.5, color: "var(--parchment-dim)" }}>
                    {msg.mods.dropzoneSubPrefix}
                    <span className="mono">.zip / .7z / .rar / .pak</span>
                    {msg.mods.dropzoneSubSuffix}
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
                    {msg.mods.pickArchive}
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
                    {msg.mods.pickFolder}
                  </button>
                </div>
              </div>

              {dash && dash.unmanaged.length > 0 && (
                <WuxiaPlaque variant="gold" agentId="wild-adopt-panel">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div>
                      <span style={{ fontWeight: 700, color: "var(--bronze-bright)" }}>
                        {msg.mods.unmanagedFound(dash.unmanaged.length)}
                      </span>
                      <span style={{ marginLeft: 10, fontSize: 12, color: "var(--parchment-dim)" }}>
                        {msg.mods.unmanagedHint}
                      </span>
                    </div>
                    <button
                      data-agent-id="btn-adopt-wild"
                      className="wuxia-btn gold"
                      disabled={busy || selectedWildIds.length === 0}
                      onClick={() =>
                        void withBusy(async () => {
                          const env = await invoke<UiEnvelope>("cmd_adopt_mods", { ids: selectedWildIds });
                          if (env.status === "ok") {
                            setSelectedWildIds([]);
                            notify(msgRef.current.toasts.adoptedSuccess);
                            await refreshDashboard();
                          } else notify(env.error ?? msgRef.current.toasts.adoptFailed, true);
                        })
                      }
                    >
                      {msg.mods.adoptBtn(selectedWildIds.length)}
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

              <InkDivider
                label={msg.mods.dividerSummary(
                  modCount,
                  Array.from(enabledMap.values()).filter(Boolean).length
                )}
              />

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <input
                  className="wuxia-input"
                  style={{ width: 280 }}
                  placeholder={msg.mods.filterPlaceholder}
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
                    {msg.mods.emptyState}
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
                            onLabel={msg.common.on}
                            offLabel={msg.common.off}
                            onChange={() =>
                              void withBusy(async () => {
                                const env = await invoke<UiEnvelope>("cmd_set_mod_enabled", {
                                  modId: mod.id,
                                  enabled: !isOn,
                                });
                                if (env.status === "ok") await refreshDashboard();
                                else notify(env.error ?? msgRef.current.toasts.toggleStateFailed, true);
                              })
                            }
                            title={isOn ? msg.mods.toggleOffTitle : msg.mods.toggleOnTitle}
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
                                  {msg.mods.updateBadge(mod.latest_remote_version!)}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 12, color: "var(--parchment-muted)", marginTop: 3 }}>
                              {msg.mods.variantMeta(
                                mod.current.variant_name,
                                mod.current.files.length,
                                mod.current.containers.length
                              )}
                            </div>
                          </div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {mod.previous && (
                            <button
                              className="wuxia-btn"
                              disabled={busy}
                              onClick={() =>
                                void withBusy(async () => {
                                  const env = await invoke<UiEnvelope>("cmd_rollback_mod", {
                                    modId: mod.id,
                                  });
                                  if (env.status === "ok") {
                                    notify(msgRef.current.toasts.rollbackSuccess(mod.previous!.version));
                                    await refreshDashboard();
                                  } else notify(env.error ?? msgRef.current.toasts.rollbackFailed, true);
                                })
                              }
                            >
                              <RotateCcw size={13} />
                              {msg.mods.rollbackBtn(mod.previous.version)}
                            </button>
                          )}
                          <button
                            className="wuxia-btn primary-crimson"
                            style={{ padding: "6px 10px" }}
                            disabled={busy}
                            onClick={() =>
                              void withBusy(async () => {
                                const env = await invoke<UiEnvelope>("cmd_remove_mod", {
                                  modId: mod.id,
                                });
                                if (env.status === "ok") {
                                  notify(msgRef.current.toasts.removedMod(mod.name));
                                  await refreshDashboard();
                                } else notify(env.error ?? msgRef.current.toasts.removeFailed, true);
                              })
                            }
                            title={msg.mods.removeTitle}
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
                {msg.diagnostics.frameworks.map((fw) => {
                  const ok = dash?.frameworks?.[fw.key] ?? false;
                  return (
                    <WuxiaPlaque key={fw.name} variant={ok ? "gold" : "default"}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontFamily: "var(--font-serif)", fontWeight: 700 }}>
                          {fw.name}
                        </span>
                        <span className={`wuxia-seal-tag ${ok ? "jade" : ""}`}>
                          {ok ? msg.diagnostics.installed : msg.diagnostics.notInstalled}
                        </span>
                      </div>
                      <p style={{ fontSize: 12, color: "var(--parchment-dim)", marginBottom: 10 }}>
                        {fw.desc}
                      </p>
                      <button
                        className="wuxia-btn"
                        style={{ padding: "4px 11px", fontSize: 12 }}
                        onClick={() =>
                          void withBusy(async () => {
                            const env = await invoke<UiEnvelope<NexusModDetailsData>>(
                              "cmd_nexus_mod_details",
                              { modId: fw.nxId }
                            );
                            if (env.status === "ok" && env.data) {
                              setNxDetails(env.data);
                              setTab("nexus");
                            } else {
                              notify(env.error ?? msgRef.current.toasts.frameworkDetailsFailed, true);
                            }
                          })
                        }
                      >
                        {msg.diagnostics.viewNexus(fw.nxId)}
                      </button>
                    </WuxiaPlaque>
                  );
                })}

                <WuxiaPlaque>
                  <div style={{ fontFamily: "var(--font-serif)", fontWeight: 700, marginBottom: 6 }}>
                    {msg.diagnostics.proxyTitle}
                  </div>
                  <p style={{ fontSize: 12, color: "var(--parchment-dim)", marginBottom: 8 }}>
                    {msg.diagnostics.proxySubBefore}
                    <span className="mono">dwmapi / hid / version / winhttp</span>
                    {msg.diagnostics.proxySubAfter}
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
                      {msg.diagnostics.proxyEmpty}
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
                  {msg.diagnostics.conflictTitle}
                </div>
                {conflictCount === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--jade-bright)" }}>
                    {msg.diagnostics.conflictEmpty}
                  </div>
                ) : (
                  <ul style={{ paddingLeft: 18, fontSize: 12.5, display: "grid", gap: 5 }}>
                    {dash?.conflict_messages.map((cm, i) => (
                      <li key={i} style={{ color: "var(--cinnabar-text)" }}>
                        {cm}
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
                lang={lang}
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
                      {msg.common.gotIt}
                    </button>
                  </div>
                </WuxiaPlaque>
              )}

              <WuxiaPlaque style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  data-agent-id="nexus-search-input"
                  className="wuxia-input"
                  style={{ flex: 1 }}
                  placeholder={msg.nexus.searchPlaceholder}
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
                  {msg.nexus.searchBtn}
                </button>
                <button
                  data-agent-id="btn-nexus-updates"
                  className="wuxia-btn gold"
                  disabled={busy}
                  onClick={() =>
                    void withBusy(async () => {
                      const env = await invoke<UiEnvelope<{ updates: UpdateEntry[] }>>(
                        "cmd_nexus_check_updates"
                      );
                      if (env.status === "ok" && env.data) {
                        setNxUpdates(env.data.updates);
                        notify(
                          env.data.updates.length > 0
                            ? msgRef.current.toasts.updatesFound(env.data.updates.length)
                            : msgRef.current.toasts.allUpToDate
                        );
                        await refreshDashboard();
                      } else {
                        notify(env.error ?? msgRef.current.toasts.checkUpdatesFailed, true);
                      }
                    })
                  }
                >
                  <Sparkles size={14} />
                  {msg.nexus.checkUpdatesBtn}
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
                        {msg.nexus.authorDownloads(
                          nxDetails.summary.author,
                          nxDetails.summary.downloads
                        )}
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
                        {msg.nexus.openPageBtn}
                      </button>
                      <button
                        className="wuxia-btn primary-crimson"
                        disabled={busy}
                        onClick={() => void handleDownloadAndInspect(nxDetails.summary.mod_id)}
                      >
                        <Download size={14} />
                        {msg.nexus.downloadInstallBtn}
                      </button>
                      <button className="wuxia-btn" onClick={() => setNxDetails(null)}>
                        {msg.common.collapse}
                      </button>
                    </div>
                  </div>
                  <p style={{ fontSize: 12.5, marginBottom: 8 }}>{nxDetails.summary.summary}</p>
                  <div style={{ fontSize: 12, color: "var(--parchment-dim)" }}>
                    <strong>{msg.nexus.requirementsLabel}</strong>
                    {nxDetails.requirements.length === 0
                      ? msg.nexus.noRequirements
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
                        {msg.nexus.cardStats(m.mod_id, m.author, m.downloads, m.category)}
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
                        {m.summary || msg.nexus.noSummary}
                      </p>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className="wuxia-btn"
                          disabled={busy}
                          onClick={() =>
                            void withBusy(async () => {
                              const env = await invoke<UiEnvelope<NexusModDetailsData>>(
                                "cmd_nexus_mod_details",
                                { modId: m.mod_id }
                              );
                              if (env.status === "ok" && env.data) setNxDetails(env.data);
                              else notify(env.error ?? msgRef.current.toasts.modDetailsFailed, true);
                            })
                          }
                        >
                          {msg.nexus.detailsBtn}
                        </button>
                        <button
                          className="wuxia-btn"
                          disabled={busy}
                          onClick={() => void handleOpenUrl(m.page_url)}
                          title={msg.nexus.openBrowserTitle}
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
                        {msg.nexus.downloadInspectBtn}
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
                  {msg.backups.manualTitle}
                </div>
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    className="wuxia-input"
                    style={{ flex: 1, minWidth: 220 }}
                    placeholder={msg.backups.notePlaceholder}
                    value={backupNote}
                    onChange={(e) => setBackupNote(e.target.value)}
                  />
                  <SealCheck
                    checked={backupPin}
                    onChange={setBackupPin}
                    label={msg.backups.pinLabel}
                  />
                  <button
                    data-agent-id="btn-backup-create"
                    className="wuxia-btn primary-crimson"
                    disabled={busy || !dash?.game}
                    onClick={() =>
                      void withBusy(async () => {
                        const env = await invoke<UiEnvelope>("cmd_create_backup", {
                          note: backupNote.trim() || null,
                          pin: backupPin,
                        });
                        if (env.status === "ok") {
                          setBackupNote("");
                          setBackupPin(false);
                          notify(msgRef.current.toasts.backupCreated);
                          await refreshDashboard();
                        } else notify(env.error ?? msgRef.current.toasts.backupFailed, true);
                      })
                    }
                  >
                    <ArchiveRestore size={14} />
                    {msg.backups.createBtn}
                  </button>
                </div>
              </WuxiaPlaque>

              {dash?.save_backups.length === 0 ? (
                <WuxiaPlaque style={{ textAlign: "center", padding: "36px 20px", color: "var(--parchment-muted)" }}>
                  {msg.backups.emptyState}
                </WuxiaPlaque>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {dash?.save_backups.slice().reverse().map((b) => (
                    <div key={b.id} data-agent-id={`backup-row:${b.id}`} className="mod-scroll-row">
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className="mono" style={{ fontWeight: 700 }}>
                            {b.id}
                          </span>
                          {b.pinned && <span className="wuxia-seal-tag gold">{msg.backups.pinnedTag}</span>}
                          <span className="wuxia-seal-tag">{b.trigger_reason}</span>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--parchment-dim)", marginTop: 3 }}>
                          {msg.backups.meta(b.note, b.file_count, formatBytes(b.size_bytes))}
                          <span className="mono">{b.sha256.slice(0, 12)}...</span>
                        </div>
                      </div>

                      {confirmRestoreId === b.id ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 12, color: "var(--cinnabar-text)" }}>
                            {msg.backups.confirmPrompt}
                          </span>
                          <button
                            className="wuxia-btn primary-crimson"
                            disabled={busy}
                            onClick={() =>
                              void withBusy(async () => {
                                const env = await invoke<UiEnvelope>("cmd_restore_backup", {
                                  backupId: b.id,
                                  confirm: true,
                                });
                                if (env.status === "ok") {
                                  setConfirmRestoreId(null);
                                  notify(msgRef.current.toasts.backupRestored);
                                  await refreshDashboard();
                                } else notify(env.error ?? msgRef.current.toasts.restoreFailed, true);
                              })
                            }
                          >
                            {msg.backups.confirmRestoreBtn}
                          </button>
                          <button className="wuxia-btn" onClick={() => setConfirmRestoreId(null)}>
                            {msg.common.cancel}
                          </button>
                        </div>
                      ) : (
                        <button
                          className="wuxia-btn"
                          disabled={busy}
                          onClick={() => setConfirmRestoreId(b.id)}
                        >
                          {msg.backups.restoreBtn}
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
                    {msg.settings.gameDirTitle}
                  </span>
                  <button className="wuxia-btn" onClick={() => void handlePickGameDir()}>
                    <FolderSearch size={14} />
                    {msg.settings.repickDirBtn}
                  </button>
                </div>
                {dash?.game ? (
                  <div className="mono" style={{ display: "grid", gap: 5, color: "var(--parchment-dim)" }}>
                    <div>{msg.settings.rootDir}{dash.game.root_dir}</div>
                    <div>{msg.settings.shippingExe}{dash.game.shipping_exe}</div>
                    <div>{msg.settings.tildeModsDir}{dash.game.tilde_mods_dir}</div>
                    <div>{msg.settings.ue4ssDir}{dash.game.ue4ss_mods_dir}</div>
                    <div>{msg.settings.saveDir}{dash.game.save_games_dir}</div>
                  </div>
                ) : (
                  <div style={{ color: "var(--parchment-muted)" }}>{msg.settings.gameNotBound}</div>
                )}
              </WuxiaPlaque>

              <NexusAuthPanel
                agentId="nexus-auth-card"
                highlighted={pulsedKey === "[data-agent-id='nexus-auth-card']"}
                hasKey={dash?.has_nexus_key ?? false}
                nxmRegistered={dash?.nxm_registered ?? false}
                account={nexusAccount}
                busy={busy}
                lang={lang}
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
                    {msg.settings.mcpTitle}
                  </span>
                  <button
                    className="wuxia-btn"
                    onClick={() => {
                      navigator.clipboard
                        .writeText(mcpSnippet)
                        .then(() => {
                          setCopiedMcp(true);
                          window.setTimeout(() => setCopiedMcp(false), 2000);
                        })
                        .catch(() => notify(msgRef.current.toasts.copyMcpFailed, true));
                    }}
                  >
                    {copiedMcp ? <Check size={13} /> : <Copy size={13} />}
                    {copiedMcp ? msg.settings.copied : msg.settings.copyMcp}
                  </button>
                </div>
                <p style={{ fontSize: 12, color: "var(--parchment-dim)", marginBottom: 8 }}>
                  {msg.settings.mcpDescBefore}
                  <span className="mono">{dash?.data_dir}</span>
                  {msg.settings.mcpDescAfter}
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
          key={`${inspectData.payload.source_path}:${inspectData.nexusId ?? ""}`}
          payload={inspectData.payload}
          busy={busy}
          lang={lang}
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
              <h2>{msg.newProfileModal.title}</h2>
            </div>
            <div className="modal-body">
              <input
                className="wuxia-input"
                placeholder={msg.newProfileModal.idPlaceholder}
                value={newProfId}
                onChange={(e) => setNewProfId(e.target.value)}
              />
              <input
                className="wuxia-input"
                placeholder={msg.newProfileModal.namePlaceholder}
                value={newProfName}
                onChange={(e) => setNewProfName(e.target.value)}
              />
              <input
                className="wuxia-input"
                placeholder={msg.newProfileModal.descPlaceholder}
                value={newProfDesc}
                onChange={(e) => setNewProfDesc(e.target.value)}
              />
              <SealCheck
                checked={newProfClone}
                onChange={setNewProfClone}
                label={msg.newProfileModal.cloneLabel}
              />
            </div>
            <div className="modal-footer">
              <button className="wuxia-btn" onClick={() => setShowNewProfile(false)}>
                {msg.common.cancel}
              </button>
              <button
                className="wuxia-btn primary-crimson"
                disabled={busy}
                onClick={() => {
                  if (!newProfId.trim() || !newProfName.trim()) {
                    return notify(msgRef.current.toasts.profileMissingFields, true);
                  }
                  void withBusy(async () => {
                    const env = await invoke<UiEnvelope>("cmd_create_profile", {
                      id: newProfId.trim(),
                      name: newProfName.trim(),
                      desc: newProfDesc.trim(),
                      cloneActive: newProfClone,
                    });
                    if (env.status === "ok") {
                      setShowNewProfile(false);
                      setNewProfId("");
                      setNewProfName("");
                      setNewProfDesc("");
                      notify(msgRef.current.toasts.profileCreated);
                      await refreshDashboard();
                    } else notify(env.error ?? msgRef.current.toasts.profileCreateFailed, true);
                  });
                }}
              >
                {msg.newProfileModal.createBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 1 + A: Clean Live Sync Status & Activity Drawer */}
      <PuppeteerOverlay activeBanner={activeBanner} events={activityLog} lang={lang} />

      {dragging && (
        <div className="drag-veil">
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "var(--font-serif)", fontSize: 24, fontWeight: 700, color: "var(--bronze-bright)" }}>
              {msg.mods.dragOverlayTitle}
            </div>
            <div style={{ fontSize: 13.5, color: "var(--parchment-dim)", marginTop: 6 }}>
              {msg.mods.dragOverlaySub}
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast-scroll ${toast.isErr ? "err" : ""}`}>{toast.text}</div>}
    </div>
  );
}
