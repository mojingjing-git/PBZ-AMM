import React, { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  ArchiveRestore,
  Boxes,
  Check,
  Compass,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  FolderSearch,
  History,
  KeyRound,
  PackagePlus,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { InspectModal } from "./components/InspectModal";
import {
  DashboardData,
  InspectPayload,
  NexusModSummary,
  UiEnvelope,
} from "./types";

type NavTab = "mods" | "diagnostics" | "nexus" | "backups" | "settings";

interface NexusModDetailsData {
  summary: NexusModSummary;
  requirements: Array<{
    mod_id: number;
    name: string;
    notes?: string | null;
  }>;
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

  // Mod list & wild adoption state
  const [modFilter, setModFilter] = useState("");
  const [selectedWildIds, setSelectedWildIds] = useState<string[]>([]);

  // Inspect & Install modal state
  const [inspectData, setInspectData] = useState<{
    payload: InspectPayload;
    nexusId?: number;
    version?: string;
  } | null>(null);

  // New Profile modal state
  const [showNewProfile, setShowNewProfile] = useState(false);
  const [newProfId, setNewProfId] = useState("");
  const [newProfName, setNewProfName] = useState("");
  const [newProfDesc, setNewProfDesc] = useState("");
  const [newProfClone, setNewProfClone] = useState(true);

  // Nexus Workshop state
  const [nxKeyword, setNxKeyword] = useState("");
  const [nxResults, setNxResults] = useState<NexusModSummary[]>([]);
  const [nxLoadedOnce, setNxLoadedOnce] = useState(false);
  const [nxDetails, setNxDetails] = useState<NexusModDetailsData | null>(null);
  const [nxUpdates, setNxUpdates] = useState<UpdateEntry[]>([]);

  // Backups state
  const [backupNote, setBackupNote] = useState("");
  const [backupPin, setBackupPin] = useState(false);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);

  // Settings & Credentials state
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [accountLabel, setAccountLabel] = useState<string | null>(null);
  const [copiedMcp, setCopiedMcp] = useState(false);

  const notify = useCallback((text: string, isErr = false) => {
    setToast({ text, isErr });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const refreshDashboard = useCallback(async () => {
    try {
      const env = await invoke<UiEnvelope<DashboardData>>("cmd_get_dashboard");
      if (env.status === "ok" && env.data) {
        setDash(env.data);
        setSelectedWildIds((prev) =>
          prev.filter((id) => env.data!.unmanaged.some((u) => u.id === id))
        );
      } else {
        notify(env.error ?? "读取枢机状态失败", true);
      }
    } catch (e) {
      notify(`连接核心失败：${String(e)}`, true);
    }
  }, [notify]);

  useEffect(() => {
    void refreshDashboard();
  }, [refreshDashboard]);

  const inspectPath = useCallback(
    async (path: string, nexusId?: number, version?: string) => {
      setBusy(true);
      try {
        const env = await invoke<UiEnvelope<InspectPayload>>("cmd_inspect_source", {
          path,
        });
        if (env.status === "ok" && env.data) {
          setInspectData({ payload: env.data, nexusId, version });
        } else {
          notify(env.error ?? "预检 Mod 包失败", true);
        }
      } catch (e) {
        notify(`预检异常：${String(e)}`, true);
      } finally {
        setBusy(false);
      }
    },
    [notify]
  );

  // Native Tauri window drag-and-drop listener
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
          if (p.paths.length > 0) {
            void inspectPath(p.paths[0]);
          }
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

  const activeProfile = useMemo(() => {
    if (!dash) return null;
    return dash.profiles[dash.active_profile_id] ?? null;
  }, [dash]);

  const enabledMap = useMemo(() => {
    const map = new Map<string, boolean>();
    if (activeProfile) {
      for (const entry of activeProfile.entries) {
        map.set(entry.mod_id, entry.enabled);
      }
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
      if (ia !== -1 || ib !== -1) {
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      }
      return a.display_name.localeCompare(b.display_name, "zh-CN");
    });
  }, [dash]);

  // Handlers
  const handlePickGameDir = async () => {
    const picked = await invoke<string | null>("cmd_pick_game_dir");
    if (!picked) return;
    setBusy(true);
    try {
      const env = await invoke<UiEnvelope>("cmd_bind_game_dir", { path: picked });
      if (env.status === "ok") {
        notify("已成功绑定《影之刃零》安装根目录");
        await refreshDashboard();
      } else {
        notify(env.error ?? "游戏目录校验未通过", true);
      }
    } finally {
      setBusy(false);
    }
  };

  const handlePickFileOrFolder = async (folder: boolean) => {
    const cmd = folder ? "cmd_pick_mod_folder" : "cmd_pick_mod_file";
    const picked = await invoke<string | null>(cmd);
    if (picked) {
      await inspectPath(picked);
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
        notify("模组已入匣并投递至当前配置");
        await refreshDashboard();
      } else {
        notify(env.error ?? "安装受阻", true);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleToggleMod = async (modId: string, enabled: boolean) => {
    setBusy(true);
    try {
      const env = await invoke<UiEnvelope>("cmd_set_mod_enabled", { modId, enabled });
      if (env.status === "ok") {
        await refreshDashboard();
      } else {
        notify(env.error ?? "切换启用状态失败", true);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRollbackMod = async (modId: string, name: string) => {
    setBusy(true);
    try {
      const env = await invoke<UiEnvelope>("cmd_rollback_mod", { modId });
      if (env.status === "ok") {
        notify(`已将「${name}」回退至上一保留版本`);
        await refreshDashboard();
      } else {
        notify(env.error ?? "回退版本失败", true);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveMod = async (modId: string, name: string) => {
    setBusy(true);
    try {
      const env = await invoke<UiEnvelope>("cmd_remove_mod", { modId });
      if (env.status === "ok") {
        notify(`已从剑匣移除「${name}」`);
        await refreshDashboard();
      } else {
        notify(env.error ?? "卸载模组失败", true);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleAdoptWild = async () => {
    if (selectedWildIds.length === 0) return;
    setBusy(true);
    try {
      const env = await invoke<UiEnvelope>("cmd_adopt_mods", { ids: selectedWildIds });
      if (env.status === "ok") {
        notify(`已接管 ${selectedWildIds.length} 项散落模组，其余未选文件保持原状`);
        setSelectedWildIds([]);
        await refreshDashboard();
      } else {
        notify(env.error ?? "接管已有模组失败", true);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSwitchProfile = async (id: string) => {
    if (dash?.active_profile_id === id) return;
    setBusy(true);
    try {
      const env = await invoke<UiEnvelope>("cmd_switch_profile", { id });
      if (env.status === "ok") {
        notify(`已切换至配置「${dash?.profiles[id]?.display_name ?? id}」（存档保持互通）`);
        await refreshDashboard();
      } else {
        notify(env.error ?? "切换配置失败", true);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCreateProfile = async () => {
    const id = newProfId.trim();
    const name = newProfName.trim();
    if (!id || !name) {
      notify("请填写配置英文标识与显示名称", true);
      return;
    }
    setBusy(true);
    try {
      const env = await invoke<UiEnvelope>("cmd_create_profile", {
        id,
        name,
        desc: newProfDesc.trim(),
        cloneActive: newProfClone,
      });
      if (env.status === "ok") {
        setShowNewProfile(false);
        setNewProfId("");
        setNewProfName("");
        setNewProfDesc("");
        notify(`已创建新配置「${name}」`);
        await refreshDashboard();
      } else {
        notify(env.error ?? "创建配置失败", true);
      }
    } finally {
      setBusy(false);
    }
  };

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
          notify(env.error ?? "Nexus 检索失败", true);
        }
      } finally {
        setBusy(false);
      }
    },
    [nxKeyword, notify]
  );

  useEffect(() => {
    if (tab === "nexus" && !nxLoadedOnce) {
      void runNexusSearch("");
    }
  }, [tab, nxLoadedOnce, runNexusSearch]);

  const handleLoadModDetails = async (modId: number) => {
    setBusy(true);
    try {
      const env = await invoke<UiEnvelope<NexusModDetailsData>>("cmd_nexus_mod_details", {
        modId,
      });
      if (env.status === "ok" && env.data) {
        setNxDetails(env.data);
        setTab("nexus");
      } else {
        notify(env.error ?? "获取模组详情失败", true);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCheckUpdates = async () => {
    setBusy(true);
    try {
      const env = await invoke<UiEnvelope<{ updates: UpdateEntry[] }>>(
        "cmd_nexus_check_updates"
      );
      if (env.status === "ok" && env.data) {
        setNxUpdates(env.data.updates);
        notify(
          env.data.updates.length > 0
            ? `发现 ${env.data.updates.length} 个模组有可用新版本`
            : "所有关联 Nexus 的模组均已是最新版本"
        );
        await refreshDashboard();
      } else {
        notify(env.error ?? "检查更新失败", true);
      }
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
        notify(`下载完成，正在开启入匣预检...`);
        await inspectPath(env.data.downloaded_path, env.data.nexus_mod_id, env.data.version);
      } else {
        notify(
          env.error ??
            "无法直连下载：免费账号请在设置中注册 nxm:// 后前往 Nexus 网页点击 Mod Manager Download",
          true
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCreateBackup = async () => {
    setBusy(true);
    try {
      const env = await invoke<UiEnvelope>("cmd_create_backup", {
        note: backupNote.trim() || null,
        pin: backupPin,
      });
      if (env.status === "ok") {
        setBackupNote("");
        setBackupPin(false);
        notify("SaveGames 存档快照已封存并完成 SHA-256 校验");
        await refreshDashboard();
      } else {
        notify(env.error ?? "创建存档备份失败", true);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreBackup = async (backupId: string) => {
    setBusy(true);
    try {
      const env = await invoke<UiEnvelope>("cmd_restore_backup", {
        backupId,
        confirm: true,
      });
      if (env.status === "ok") {
        setConfirmRestoreId(null);
        notify("存档快照已安全回档（回档前状态已自动留底）");
        await refreshDashboard();
      } else {
        notify(env.error ?? "恢复存档失败", true);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSaveApiKey = async () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) {
      notify("请先粘贴有效的 Nexus Personal API Key", true);
      return;
    }
    setBusy(true);
    try {
      const env = await invoke<
        UiEnvelope<{ account?: { name: string; is_premium: boolean } }>
      >("cmd_nexus_auth", {
        apiKey: trimmed,
        clear: false,
        registerNxm: true,
      });
      if (env.status === "ok" && env.data?.account) {
        setApiKeyInput("");
        const acc = env.data.account;
        setAccountLabel(`${acc.name} (${acc.is_premium ? "Premium 直连" : "Free 网页确认"})`);
        notify(`已验证账号 ${acc.name}，存入 Windows 凭据管理器并关联 nxm:// 协议`);
        await refreshDashboard();
      } else {
        notify(env.error ?? "凭据验证失败", true);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterNxmOnly = async () => {
    setBusy(true);
    try {
      const env = await invoke<UiEnvelope>("cmd_nexus_auth", {
        apiKey: null,
        clear: false,
        registerNxm: true,
      });
      if (env.status === "ok") {
        notify("已在当前用户注册表写入 nxm:// 协议关联");
      } else {
        notify(env.error ?? "注册 nxm:// 协议失败", true);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleClearApiKey = async () => {
    setBusy(true);
    try {
      const env = await invoke<UiEnvelope>("cmd_nexus_auth", {
        apiKey: null,
        clear: true,
        registerNxm: false,
      });
      if (env.status === "ok") {
        setAccountLabel(null);
        notify("已从 Windows 凭据管理器清除 Nexus API Key");
        await refreshDashboard();
      } else {
        notify(env.error ?? "清除凭据失败", true);
      }
    } finally {
      setBusy(false);
    }
  };

  const mcpSnippet = useMemo(() => {
    return JSON.stringify(
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
    );
  }, [dash]);

  const conflictCount = dash?.conflict_messages.length ?? 0;
  const modCount = dash ? Object.keys(dash.mods).length : 0;

  const headingMeta: Record<NavTab, { title: string; sub: string }> = {
    mods: { title: "剑匣 · 模组管理", sub: "硬链接零拷贝投递 · 多变体与容器冲突预检" },
    diagnostics: { title: "玄机 · 前置与冲突", sub: "双脚本框架态势感知 · .pak / .utoc 资产级查重" },
    nexus: { title: "藏经阁 · Nexus 工坊", sub: "Phantom Blade Zero (#10614) 检索、更新与一键入匣" },
    backups: { title: "残卷 · 存档时光机", sub: "SaveGames 自动留底 · 配额轮转与双重确认回档" },
    settings: { title: "枢机 · 设置与 Agent", sub: "游戏目录绑定 · 系统凭据库 · CLI / MCP 同核协同" },
  };

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand-box">
          <div className="brand-seal">刃</div>
          <div>
            <div className="brand-title">PBZ-AMM</div>
            <div className="brand-sub">影之刃零 · 模组枢机</div>
          </div>
        </div>

        <nav className="nav-list">
          <button
            className={`nav-item ${tab === "mods" ? "active" : ""}`}
            onClick={() => setTab("mods")}
          >
            <span className="nav-item-left">
              <Boxes size={16} />
              剑匣 · 模组
            </span>
            <span className="badge-count">{modCount}</span>
          </button>

          <button
            className={`nav-item ${tab === "diagnostics" ? "active" : ""}`}
            onClick={() => setTab("diagnostics")}
          >
            <span className="nav-item-left">
              <ShieldCheck size={16} />
              玄机 · 诊断
            </span>
            {conflictCount > 0 && <span className="badge-count warn">{conflictCount}</span>}
          </button>

          <button
            className={`nav-item ${tab === "nexus" ? "active" : ""}`}
            onClick={() => setTab("nexus")}
          >
            <span className="nav-item-left">
              <Compass size={16} />
              藏经阁 · 工坊
            </span>
            {nxUpdates.length > 0 && <span className="badge-count warn">{nxUpdates.length}</span>}
          </button>

          <button
            className={`nav-item ${tab === "backups" ? "active" : ""}`}
            onClick={() => setTab("backups")}
          >
            <span className="nav-item-left">
              <History size={16} />
              残卷 · 存档
            </span>
            <span className="badge-count">{dash?.save_backups.length ?? 0}</span>
          </button>

          <button
            className={`nav-item ${tab === "settings" ? "active" : ""}`}
            onClick={() => setTab("settings")}
          >
            <span className="nav-item-left">
              <Settings2 size={16} />
              枢机 · 设置
            </span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>
              {dash?.game ? `已就绪 (${formatStore(dash.game.store)})` : "未定位游戏目录"}
            </span>
            <button
              className="btn"
              style={{ padding: "3px 7px", fontSize: 11 }}
              onClick={() => void refreshDashboard()}
              disabled={busy}
              title="同步磁盘与 CLI 最新状态"
            >
              <RefreshCw size={12} />
            </button>
          </div>
          <div className="mono" style={{ fontSize: 10.5, opacity: 0.75 }}>
            Apache-2.0 · Rust Shared Core
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-pane">
        <header className="topbar">
          <div className="page-heading">
            <h1>{headingMeta[tab].title}</h1>
            <span>{headingMeta[tab].sub}</span>
          </div>

          <div className="profile-bar">
            <span style={{ fontSize: 12, color: "var(--text-muted)", marginRight: 2 }}>
              当前配置：
            </span>
            {sortedProfiles.map((p) => (
              <button
                key={p.id}
                className={`profile-pill ${dash?.active_profile_id === p.id ? "active" : ""}`}
                onClick={() => void handleSwitchProfile(p.id)}
                disabled={busy || !dash?.game}
                title={p.description || p.display_name}
              >
                {p.display_name}
              </button>
            ))}
            <button
              className="btn"
              style={{ padding: "4px 9px" }}
              onClick={() => setShowNewProfile(true)}
              title="新建独立模组配置方案（共用游戏存档）"
            >
              <Plus size={13} />
              新建
            </button>
          </div>
        </header>

        <div className="scroll-body">
          {/* Missing Game Banner */}
          {dash && !dash.game && (
            <div className="wuxia-card crimson-edge">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 16,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: "#f08086", marginBottom: 4 }}>
                    尚未检测到《影之刃零》安装目录
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                    {dash.game_missing_reason ??
                      "未能从 Steam (4115450) 或 Epic 清单自动定位，请手动指定包含 ProjectPBZ 与 platform 的游戏根目录。"}
                  </div>
                </div>
                <button className="btn btn-gold" onClick={() => void handlePickGameDir()}>
                  <FolderSearch size={15} />
                  定位游戏根目录
                </button>
              </div>
            </div>
          )}

          {/* TAB 1: MODS */}
          {tab === "mods" && (
            <>
              <div className="dropzone">
                <div>
                  <div className="dropzone-title">拖入压缩包或目录 · 自动预检入匣</div>
                  <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                    支持 <span className="mono">.zip / .7z / .rar / .pak</span> 或解压文件夹；自动改写跨平台路径，遇到多选一变体或冲突必先停下由你定夺。
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
                  <button
                    className="btn btn-gold"
                    disabled={busy || !dash?.game}
                    onClick={() => void handlePickFileOrFolder(false)}
                  >
                    <PackagePlus size={15} />
                    选择压缩包
                  </button>
                  <button
                    className="btn"
                    disabled={busy || !dash?.game}
                    onClick={() => void handlePickFileOrFolder(true)}
                  >
                    <FolderOpen size={15} />
                    选择文件夹
                  </button>
                </div>
              </div>

              {/* Unmanaged Wild Mods Callout */}
              {dash && dash.unmanaged.length > 0 && (
                <div className="wuxia-card gold-edge">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 10,
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: 600, color: "var(--accent-gold-bright)" }}>
                        发现 {dash.unmanaged.length} 项手工安装的野生 Mod
                      </span>
                      <span
                        style={{ marginLeft: 10, fontSize: 12, color: "var(--text-secondary)" }}
                      >
                        勾选后可纳入剑匣统一开关与备份；未勾选项将保持原位绝不触碰。
                      </span>
                    </div>
                    <button
                      className="btn btn-gold"
                      disabled={busy || selectedWildIds.length === 0}
                      onClick={() => void handleAdoptWild()}
                    >
                      纳入托管 ({selectedWildIds.length})
                    </button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {dash.unmanaged.map((u) => {
                      const checked = selectedWildIds.includes(u.id);
                      return (
                        <label
                          key={u.id}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "7px 11px",
                            background: "var(--bg-elevated)",
                            border: "1px solid var(--border-subtle)",
                            cursor: "pointer",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setSelectedWildIds((prev) =>
                                  e.target.checked
                                    ? [...prev, u.id]
                                    : prev.filter((x) => x !== u.id)
                                )
                              }
                            />
                            <span style={{ fontWeight: 500 }}>{u.name}</span>
                            <span className="tag">{u.target}</span>
                          </div>
                          <span className="mono" style={{ color: "var(--text-muted)" }}>
                            {u.game_rel_paths[0]} ({formatBytes(u.total_bytes)})
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Installed Mods Filter & List */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  剑匣藏品共 <strong>{modCount}</strong> 件 · 当前配置「
                  {activeProfile?.display_name ?? "默认"}」已启用{" "}
                  <strong>
                    {Array.from(enabledMap.values()).filter(Boolean).length}
                  </strong>{" "}
                  件
                </div>
                <input
                  className="input-field"
                  style={{ width: 260 }}
                  placeholder="筛选模组名称 / ID / 类别..."
                  value={modFilter}
                  onChange={(e) => setModFilter(e.target.value)}
                />
              </div>

              {sortedMods.length === 0 ? (
                <div
                  className="wuxia-card"
                  style={{ textAlign: "center", padding: "38px 20px", color: "var(--text-muted)" }}
                >
                  剑匣尚空。可将下载好的 Mod 压缩包直接拖入窗口，或前往「藏经阁」检索《影之刃零》社区作品。
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {sortedMods.map((mod) => {
                    const isOn = enabledMap.get(mod.id) ?? false;
                    const hasUpdate =
                      mod.latest_remote_version &&
                      mod.latest_remote_version !== mod.current.version;
                    return (
                      <div key={mod.id} className={`mod-row ${isOn ? "" : "disabled"}`}>
                        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                          <div
                            className={`blade-switch ${isOn ? "on" : ""}`}
                            onClick={() => !busy && void handleToggleMod(mod.id, !isOn)}
                            title={isOn ? "点击在当前配置中停用" : "点击在当前配置中启用"}
                          />
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontWeight: 600, fontSize: 14 }}>{mod.name}</span>
                              <span className="tag">v{mod.current.version}</span>
                              {mod.current.categories.map((cat) => (
                                <span key={cat} className="tag gold">
                                  {cat}
                                </span>
                              ))}
                              {mod.nexus_mod_id && (
                                <span className="tag jade">Nexus #{mod.nexus_mod_id}</span>
                              )}
                              {hasUpdate && (
                                <span className="tag crimson">
                                  可更新 v{mod.latest_remote_version}
                                </span>
                              )}
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                color: "var(--text-muted)",
                                marginTop: 3,
                              }}
                            >
                              变体：{mod.current.variant_name} · {mod.current.files.length} 个文件
                              {mod.current.containers.length > 0 &&
                                ` · ${mod.current.containers.length} 个 Pak/IoStore 容器`}
                            </div>
                          </div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {mod.previous && (
                            <button
                              className="btn"
                              disabled={busy}
                              onClick={() => void handleRollbackMod(mod.id, mod.name)}
                              title={`一键回退至上一保留版本 v${mod.previous.version}`}
                            >
                              <RotateCcw size={13} />
                              回退 v{mod.previous.version}
                            </button>
                          )}
                          <button
                            className="btn btn-crimson"
                            disabled={busy}
                            onClick={() => void handleRemoveMod(mod.id, mod.name)}
                            title="从游戏与剑匣中彻底移除"
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
                    name: "UE4SS (PBZ 定制版)",
                    nxId: 13,
                    ok: dash?.frameworks?.ue4ss ?? false,
                    desc: "部署于 platform/<store>/dwmapi.dll 及 ue4ss/Mods/，支撑 Lua 与 C++ 底层扩展。",
                  },
                  {
                    name: "Mods Menu (F2 菜单框架)",
                    nxId: 149,
                    ok: dash?.frameworks?.mods_menu ?? false,
                    desc: "部署于根目录 hid.dll 及 ProjectPBZ/Content/JavaScript/PBZModsMenu/Mods/。",
                  },
                  {
                    name: "PBZModLoader (Puerts 加载器)",
                    nxId: 113,
                    ok: dash?.frameworks?.pbz_mod_loader ?? false,
                    desc: "部署于 ProjectPBZ/PBZModLoader/mods/，注意 v2.0 起仅加载预编译 .js 脚本。",
                  },
                  {
                    name: "CPP Pak Bypass (脚本包绕过)",
                    nxId: 520,
                    ok: dash?.frameworks?.cpp_pak_bypass ?? false,
                    desc: "修复 11 月补丁后含 JavaScript 的 .pak 模组被引擎拒绝挂载的问题。",
                  },
                  {
                    name: "PBZ Outfit Framework (独立衣柜)",
                    nxId: 903,
                    ok: dash?.frameworks?.outfit_framework ?? false,
                    desc: "实现服装模组非替换式独立追加，避免多套外观抢占同一基础时装槽位。",
                  },
                ].map((fw) => (
                  <div key={fw.name} className="wuxia-card">
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 6,
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{fw.name}</span>
                      <span className={`tag ${fw.ok ? "jade" : ""}`}>
                        {fw.ok ? "已检出就绪" : "未安装"}
                      </span>
                    </div>
                    <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10 }}>
                      {fw.desc}
                    </p>
                    <button
                      className="btn"
                      style={{ fontSize: 12, padding: "4px 10px" }}
                      onClick={() => void handleLoadModDetails(fw.nxId)}
                    >
                      查看 Nexus #{fw.nxId} 详情
                    </button>
                  </div>
                ))}

                <div className="wuxia-card">
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>代理注入 DLL 槽位占用</div>
                  <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>
                    检测游戏根目录与二进制目录的 <span className="mono">dwmapi / hid / version / winhttp</span> 占用情况，防止多个注入器静默覆盖：
                  </p>
                  {dash?.frameworks?.occupied_proxy_dlls.length ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {dash.frameworks.occupied_proxy_dlls.map((dll) => (
                        <span key={dll} className="tag gold mono">
                          {dll}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      当前未检测到代理注入 DLL
                    </span>
                  )}
                </div>
              </div>

              <div className={`wuxia-card ${conflictCount > 0 ? "crimson-edge" : "gold-edge"}`}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>
                  当前配置冲突审计（文件路径 + .pak / .utoc 虚拟资产与 ChunkId）
                </div>
                {conflictCount === 0 ? (
                  <div style={{ fontSize: 13, color: "#7cc4a8" }}>
                    未发现任何文件级或容器内部资产重叠，当前配置秩序井然。
                  </div>
                ) : (
                  <ul style={{ paddingLeft: 18, fontSize: 12.5, display: "grid", gap: 5 }}>
                    {dash?.conflict_messages.map((msg, i) => (
                      <li key={i} style={{ color: "#f08086" }}>
                        {msg}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          {/* TAB 3: NEXUS */}
          {tab === "nexus" && (
            <>
              <div className="wuxia-card" style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  className="input-field"
                  style={{ flex: 1 }}
                  placeholder="免登录搜索 Nexus《影之刃零》模组（留空按下载热度排序）..."
                  value={nxKeyword}
                  onChange={(e) => setNxKeyword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void runNexusSearch()}
                />
                <button
                  className="btn btn-gold"
                  disabled={busy}
                  onClick={() => void runNexusSearch()}
                >
                  <Search size={14} />
                  搜索工坊
                </button>
                <button className="btn" disabled={busy} onClick={() => void handleCheckUpdates()}>
                  <Sparkles size={14} />
                  检查已装更新
                </button>
              </div>

              {nxUpdates.length > 0 && (
                <div className="wuxia-card gold-edge">
                  <div style={{ fontWeight: 600, color: "var(--accent-gold-bright)", marginBottom: 8 }}>
                    检测到 {nxUpdates.length} 项可用更新（更新后自动保留旧版供一键回退）：
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {nxUpdates.map((u) => (
                      <div
                        key={u.mod_id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          fontSize: 12.5,
                        }}
                      >
                        <span>
                          <strong>{u.name}</strong>：v{u.current} →{" "}
                          <span style={{ color: "var(--accent-gold-bright)" }}>v{u.latest}</span>
                        </span>
                        <button
                          className="btn btn-gold"
                          style={{ padding: "3px 10px" }}
                          disabled={busy}
                          onClick={() => void handleDownloadAndInspect(u.nexus_mod_id)}
                        >
                          拉取新版并预检
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {nxDetails && (
                <div className="wuxia-card gold-edge">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: 8,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>
                        {nxDetails.summary.name}{" "}
                        <span className="tag gold">#{nxDetails.summary.mod_id}</span>{" "}
                        <span className="tag">v{nxDetails.summary.version}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                        作者：{nxDetails.summary.author} · 下载：{nxDetails.summary.downloads} ·{" "}
                        <span className="mono">{nxDetails.summary.page_url}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        className="btn btn-gold"
                        disabled={busy}
                        onClick={() => void handleDownloadAndInspect(nxDetails.summary.mod_id)}
                      >
                        <Download size={14} />
                        下载并预检
                      </button>
                      <button className="btn" onClick={() => setNxDetails(null)}>
                        收起
                      </button>
                    </div>
                  </div>
                  <p style={{ fontSize: 12.5, color: "var(--text-primary)", marginBottom: 8 }}>
                    {nxDetails.summary.summary}
                  </p>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    <strong>前置依赖要求：</strong>
                    {nxDetails.requirements.length === 0 ? (
                      " 无额外前置依赖"
                    ) : (
                      <ul style={{ paddingLeft: 18, marginTop: 4 }}>
                        {nxDetails.requirements.map((r) => (
                          <li key={r.mod_id}>
                            #{r.mod_id} {r.name} {r.notes ? `(${r.notes})` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              <div className="grid-2">
                {nxResults.map((m) => (
                  <div
                    key={m.mod_id}
                    className="wuxia-card"
                    style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}
                  >
                    <div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 8,
                          marginBottom: 4,
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{m.name}</span>
                        <span className="tag">v{m.version}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 6 }}>
                        #{m.mod_id} · {m.author} · {m.downloads.toLocaleString()} 次下载
                        {m.category ? ` · ${m.category}` : ""}
                      </div>
                      <p
                        style={{
                          fontSize: 12.5,
                          color: "var(--text-secondary)",
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
                      <button
                        className="btn"
                        disabled={busy}
                        onClick={() => void handleLoadModDetails(m.mod_id)}
                      >
                        <ExternalLink size={13} />
                        详情与前置
                      </button>
                      <button
                        className="btn btn-gold"
                        disabled={busy}
                        onClick={() => void handleDownloadAndInspect(m.mod_id)}
                      >
                        <Download size={13} />
                        下载入匣
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* TAB 4: BACKUPS */}
          {tab === "backups" && (
            <>
              <div className="wuxia-card gold-edge">
                <div style={{ fontWeight: 600, marginBottom: 8, color: "var(--accent-gold-bright)" }}>
                  手动封存当前 SaveGames 存档
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input
                    className="input-field"
                    style={{ flex: 1 }}
                    placeholder="备注说明（例如：挑战Boss前 / 切换大型玩法Mod前）..."
                    value={backupNote}
                    onChange={(e) => setBackupNote(e.target.value)}
                  />
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12.5,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={backupPin}
                      onChange={(e) => setBackupPin(e.target.checked)}
                    />
                    永久锁定（免于配额清理）
                  </label>
                  <button
                    className="btn btn-gold"
                    disabled={busy || !dash?.game}
                    onClick={() => void handleCreateBackup()}
                  >
                    <ArchiveRestore size={14} />
                    立即封存
                  </button>
                </div>
              </div>

              {dash?.save_backups.length === 0 ? (
                <div
                  className="wuxia-card"
                  style={{ textAlign: "center", padding: "32px 20px", color: "var(--text-muted)" }}
                >
                  暂无存档快照。在首次安装、卸载或切换配置前，枢机会自动为你建立防损快照。
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {dash?.save_backups.map((b) => (
                    <div key={b.id} className="mod-row">
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className="mono" style={{ fontWeight: 600 }}>
                            {b.id}
                          </span>
                          {b.pinned && <span className="tag gold">已锁定永久保留</span>}
                          <span className="tag">{b.trigger_reason}</span>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 3 }}>
                          {b.note ? `备注：${b.note} · ` : ""}
                          包含 {b.file_count} 个存档文件 · {formatBytes(b.size_bytes)} · SHA256:{" "}
                          <span className="mono">{b.sha256.slice(0, 12)}...</span>
                        </div>
                      </div>

                      {confirmRestoreId === b.id ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 12, color: "#f08086" }}>
                            确认覆盖当前存档？（请先关闭游戏）
                          </span>
                          <button
                            className="btn btn-crimson"
                            disabled={busy}
                            onClick={() => void handleRestoreBackup(b.id)}
                          >
                            确认回档
                          </button>
                          <button className="btn" onClick={() => setConfirmRestoreId(null)}>
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          className="btn"
                          disabled={busy}
                          onClick={() => setConfirmRestoreId(b.id)}
                        >
                          回档至此快照
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* TAB 5: SETTINGS & AGENT */}
          {tab === "settings" && (
            <>
              <div className="wuxia-card">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 10,
                  }}
                >
                  <span style={{ fontWeight: 600 }}>《影之刃零》路径映射</span>
                  <button className="btn" onClick={() => void handlePickGameDir()}>
                    <FolderSearch size={14} />
                    重新选择根目录
                  </button>
                </div>
                {dash?.game ? (
                  <div
                    className="mono"
                    style={{
                      display: "grid",
                      gap: 5,
                      fontSize: 12,
                      color: "var(--text-secondary)",
                    }}
                  >
                    <div>游戏根目录：{dash.game.root_dir}</div>
                    <div>真实执行端：{dash.game.shipping_exe}</div>
                    <div>Pak ~mods：{dash.game.tilde_mods_dir}</div>
                    <div>UE4SS 目录：{dash.game.ue4ss_mods_dir}</div>
                    <div>存档目录：{dash.game.save_games_dir}</div>
                  </div>
                ) : (
                  <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>尚未绑定游戏目录</div>
                )}
              </div>

              <div className="wuxia-card">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <KeyRound size={15} color="#c8a26a" />
                    <span style={{ fontWeight: 600 }}>Nexus Mods 账号凭据与 nxm:// 协议</span>
                  </div>
                  <span className={`tag ${dash?.has_nexus_key ? "jade" : ""}`}>
                    {accountLabel ?? (dash?.has_nexus_key ? "已存于 Windows 凭据库" : "未配置凭据")}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10 }}>
                  密钥仅加密保存在系统自带的 Windows Credential Manager 中，绝不明文落盘。Premium 会员支持静默直连下载；免费账号点击「注册 nxm:// 协议」后可在网页端唤起 CLI/GUI 下载。
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="password"
                    className="input-field"
                    style={{ flex: 1 }}
                    placeholder="粘贴 Nexus Personal API Key..."
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                  />
                  <button
                    className="btn btn-gold"
                    disabled={busy}
                    onClick={() => void handleSaveApiKey()}
                  >
                    验证保存并注册协议
                  </button>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => void handleRegisterNxmOnly()}
                    title="仅在 HKCU 注册表中关联 nxm:// 协议"
                  >
                    仅注册 nxm://
                  </button>
                  {dash?.has_nexus_key && (
                    <button
                      className="btn btn-crimson"
                      disabled={busy}
                      onClick={() => void handleClearApiKey()}
                    >
                      清除凭据
                    </button>
                  )}
                </div>
              </div>

              <div className="wuxia-card gold-edge">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <span style={{ fontWeight: 600, color: "var(--accent-gold-bright)" }}>
                    CLI 与 AI Agent (MCP) 同核接入配置
                  </span>
                  <button
                    className="btn"
                    onClick={() => {
                      void navigator.clipboard.writeText(mcpSnippet);
                      setCopiedMcp(true);
                      window.setTimeout(() => setCopiedMcp(false), 2000);
                    }}
                  >
                    {copiedMcp ? <Check size={13} /> : <Copy size={13} />}
                    {copiedMcp ? "已复制配置" : "复制 MCP JSON"}
                  </button>
                </div>
                <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>
                  桌面端与命令行共用同一数据仓（<span className="mono">{dash?.data_dir}</span>）与文件锁。将下方配置填入你的 Agent 客户端，即可让 AI 安全执行检索、冲突分析、装卸与备份：
                </p>
                <pre
                  className="mono"
                  style={{
                    background: "#0b0d12",
                    padding: "10px 12px",
                    border: "1px solid var(--border-subtle)",
                    overflowX: "auto",
                    color: "var(--accent-gold-bright)",
                  }}
                >
                  {mcpSnippet}
                </pre>
              </div>
            </>
          )}
        </div>
      </main>

      {/* Inspect & Install Modal */}
      {inspectData && (
        <InspectModal
          payload={inspectData.payload}
          busy={busy}
          nexusIdOverride={inspectData.nexusId}
          versionOverride={inspectData.version}
          onClose={() => setInspectData(null)}
          onConfirmInstall={(opts) => void handleConfirmInstall(opts)}
        />
      )}

      {/* New Profile Modal */}
      {showNewProfile && (
        <div className="modal-backdrop" onClick={() => setShowNewProfile(false)}>
          <div
            className="modal-panel"
            style={{ maxWidth: 460 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>新建模组配置方案</h2>
            </div>
            <div className="modal-body">
              <input
                className="input-field"
                placeholder="英文标识 ID（如 practice / outfits）"
                value={newProfId}
                onChange={(e) => setNewProfId(e.target.value)}
              />
              <input
                className="input-field"
                placeholder="显示名称（如 练刀配置 / 纯外观党）"
                value={newProfName}
                onChange={(e) => setNewProfName(e.target.value)}
              />
              <input
                className="input-field"
                placeholder="用途备注（可选）"
                value={newProfDesc}
                onChange={(e) => setNewProfDesc(e.target.value)}
              />
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12.5,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={newProfClone}
                  onChange={(e) => setNewProfClone(e.target.checked)}
                />
                复制当前配置的模组启用列表（存档始终全局互通）
              </label>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowNewProfile(false)}>
                取消
              </button>
              <button
                className="btn btn-gold"
                disabled={busy}
                onClick={() => void handleCreateProfile()}
              >
                创建配置
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Window Drag Veil */}
      {dragging && (
        <div className="drag-veil">
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: 22,
                color: "var(--accent-gold-bright)",
                marginBottom: 6,
              }}
            >
              松手以启动入匣预检
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              自动校验压缩包结构、可选变体与 .pak / .utoc 内部资产冲突
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && <div className={`toast-bar ${toast.isErr ? "err" : ""}`}>{toast.text}</div>}
    </div>
  );
}
