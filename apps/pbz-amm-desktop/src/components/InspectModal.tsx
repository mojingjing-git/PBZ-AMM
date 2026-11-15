import React, { useState } from "react";
import { AlertTriangle, CheckCircle2, FileArchive, Layers, ShieldAlert, X } from "lucide-react";
import { InspectPayload } from "../types";

interface InspectModalProps {
  payload: InspectPayload;
  busy: boolean;
  nexusIdOverride?: number;
  versionOverride?: string;
  onClose: () => void;
  onConfirmInstall: (opts: {
    path: string;
    selectVariant?: string;
    allowConflicts: boolean;
    allowUncertain: boolean;
    nexusId?: number;
    version?: string;
  }) => void;
}

export const InspectModal: React.FC<InspectModalProps> = ({
  payload,
  busy,
  nexusIdOverride,
  versionOverride,
  onClose,
  onConfirmInstall,
}) => {
  const { report, conflict_texts, source_path } = payload;
  const [selectedVariant, setSelectedVariant] = useState<string>(
    report.variants.length === 1 ? report.variants[0].name : ""
  );
  const [allowConflicts, setAllowConflicts] = useState(false);
  const [allowUncertain, setAllowUncertain] = useState(false);

  const activeVariant = report.variants.find((v) => v.name === selectedVariant) ?? null;
  const activeConflicts = activeVariant ? conflict_texts[activeVariant.name] ?? [] : [];
  const uncertainFiles = activeVariant
    ? activeVariant.files.filter((f) => f.uncertain)
    : [];
  const hasBlockingProblems = (activeVariant?.problems.length ?? 0) > 0;

  const canSubmit =
    !busy &&
    activeVariant !== null &&
    !hasBlockingProblems &&
    (activeConflicts.length === 0 || allowConflicts) &&
    (uncertainFiles.length === 0 || allowUncertain);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <FileArchive size={18} color="#c8a26a" />
            <h2>入匣预检 · {report.suggested_name}</h2>
          </div>
          <button className="btn" onClick={onClose} style={{ padding: "4px 8px" }}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            来源路径：<span className="mono">{source_path}</span>
            {(nexusIdOverride || report.nexus_mod_id_hint) && (
              <span className="tag gold" style={{ marginLeft: 8 }}>
                Nexus #{nexusIdOverride ?? report.nexus_mod_id_hint}
              </span>
            )}
          </div>

          {report.ignored_executables.length > 0 && (
            <div className="wuxia-card" style={{ padding: "10px 14px", fontSize: 12 }}>
              <span style={{ color: "var(--accent-gold-bright)" }}>安全隔离：</span>
              已自动忽略包内附带的 {report.ignored_executables.length} 个可执行脚本/程序（绝不执行外部代码）。
            </div>
          )}

          {report.variants.length > 1 && (
            <div className="wuxia-card gold-edge">
              <div style={{ fontWeight: 600, marginBottom: 8, color: "var(--accent-gold-bright)" }}>
                <Layers size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
                检测到 {report.variants.length} 个互斥可选变体，请选定其一：
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {report.variants.map((v) => {
                  const picked = selectedVariant === v.name;
                  return (
                    <label
                      key={v.name}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "9px 12px",
                        border: `1px solid ${picked ? "var(--accent-gold)" : "var(--border-subtle)"}`,
                        background: picked ? "var(--accent-gold-dim)" : "var(--bg-elevated)",
                        cursor: "pointer",
                        borderRadius: 2,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <input
                          type="radio"
                          name="variant"
                          checked={picked}
                          onChange={() => {
                            setSelectedVariant(v.name);
                            setAllowConflicts(false);
                            setAllowUncertain(false);
                          }}
                        />
                        <span style={{ fontWeight: 500 }}>{v.name}</span>
                      </div>
                      <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
                        {v.categories.join(" / ")} · {v.files.length} 个文件
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {activeVariant && (
            <>
              <div className="wuxia-card">
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontWeight: 600 }}>投递清单预览（变体：{activeVariant.name}）</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    {activeVariant.categories.map((c) => (
                      <span key={c} className="tag gold">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
                <div
                  className="mono"
                  style={{
                    maxHeight: 135,
                    overflowY: "auto",
                    background: "#0c0e13",
                    padding: "8px 10px",
                    border: "1px solid var(--border-subtle)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {activeVariant.files.map((f, idx) => (
                    <div key={idx}>
                      [{f.target}] → {f.target_rel}
                      {f.is_user_config ? " (配置文件·更新保留)" : ""}
                    </div>
                  ))}
                </div>
                {activeVariant.containers.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-secondary)" }}>
                    已解析容器索引：{activeVariant.containers.length} 个（共检索{" "}
                    {activeVariant.containers.reduce((acc, c) => acc + c.asset_paths.length, 0)} 条虚拟资产路径 /{" "}
                    {activeVariant.containers.reduce((acc, c) => acc + c.chunk_ids.length, 0)} 个 IoStore 数据块）
                  </div>
                )}
              </div>

              {activeVariant.warnings.map((w, i) => (
                <div key={i} className="wuxia-card gold-edge" style={{ padding: "10px 14px", fontSize: 12.5 }}>
                  <AlertTriangle size={14} color="#c8a26a" style={{ verticalAlign: "-2px", marginRight: 6 }} />
                  {w}
                </div>
              ))}

              {activeVariant.problems.map((p, i) => (
                <div key={i} className="wuxia-card crimson-edge" style={{ padding: "10px 14px", fontSize: 12.5 }}>
                  <ShieldAlert size={14} color="#e25a61" style={{ verticalAlign: "-2px", marginRight: 6 }} />
                  错误阻断：{p}
                </div>
              ))}

              {activeConflicts.length > 0 && (
                <div className="wuxia-card crimson-edge">
                  <div style={{ fontWeight: 600, color: "#f08086", marginBottom: 6 }}>
                    检测到 {activeConflicts.length} 项文件或内部资产重叠：
                  </div>
                  <ul style={{ paddingLeft: 18, fontSize: 12, color: "var(--text-primary)", marginBottom: 10 }}>
                    {activeConflicts.map((c, idx) => (
                      <li key={idx}>{c}</li>
                    ))}
                  </ul>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12.5 }}>
                    <input
                      type="checkbox"
                      checked={allowConflicts}
                      onChange={(e) => setAllowConflicts(e.target.checked)}
                    />
                    我已知晓上述覆盖关系，确认继续安装
                  </label>
                </div>
              )}

              {uncertainFiles.length > 0 && (
                <div className="wuxia-card crimson-edge">
                  <div style={{ fontWeight: 600, color: "#f08086", marginBottom: 6 }}>
                    包含非常规命名的二进制 DLL 文件：
                  </div>
                  <div className="mono" style={{ marginBottom: 8 }}>
                    {uncertainFiles.map((u) => u.target_rel).join(", ")}
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12.5 }}>
                    <input
                      type="checkbox"
                      checked={allowUncertain}
                      onChange={(e) => setAllowUncertain(e.target.checked)}
                    />
                    信任此来源并允许放置到游戏执行目录
                  </label>
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            className="btn btn-gold"
            disabled={!canSubmit}
            onClick={() =>
              activeVariant &&
              onConfirmInstall({
                path: source_path,
                selectVariant: report.variants.length > 1 ? activeVariant.name : undefined,
                allowConflicts,
                allowUncertain,
                nexusId: nexusIdOverride ?? report.nexus_mod_id_hint ?? undefined,
                version: versionOverride,
              })
            }
          >
            <CheckCircle2 size={14} />
            {busy ? "正在入匣部署..." : "确认入匣启用"}
          </button>
        </div>
      </div>
    </div>
  );
};
