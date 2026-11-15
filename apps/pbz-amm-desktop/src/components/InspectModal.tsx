import React, { useState } from "react";
import { AlertTriangle, Layers, ShieldAlert, X } from "lucide-react";
import { InspectPayload } from "../types";
import { InkDivider, SealCheck, WuxiaPlaque } from "./WuxiaPrimitives";

interface InspectModalProps {
  payload: InspectPayload;
  busy: boolean;
  triggeredByAgent?: boolean;
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
  triggeredByAgent,
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
      <div className="modal-scroll-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/assets/seal-emblem.png" alt="" width={34} height={34} />
            <div>
              <h2>入匣鉴剑 · {report.suggested_name}</h2>
              {triggeredByAgent && (
                <div style={{ fontSize: 11.5, color: "#e89a9e", marginTop: 2 }}>
                  ◆ 悬丝机括已为你拆封此卷，可直接在界面点选入匣，或于命令行续令 ◆
                </div>
              )}
            </div>
          </div>
          <button className="wuxia-btn" onClick={onClose} style={{ padding: "4px 9px" }}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            卷宗出处：<span className="mono">{source_path}</span>
            {(nexusIdOverride || report.nexus_mod_id_hint) && (
              <span className="wuxia-seal-tag gold" style={{ marginLeft: 8 }}>
                藏经阁 #{nexusIdOverride ?? report.nexus_mod_id_hint}
              </span>
            )}
          </div>

          {report.ignored_executables.length > 0 && (
            <WuxiaPlaque variant="gold" style={{ padding: "10px 14px", fontSize: 12 }}>
              <span style={{ color: "var(--accent-gold-bright)", fontWeight: 600 }}>
                封刃隔离：
              </span>
              已自动剔除包内附带的 {report.ignored_executables.length} 个外部可执行脚本/程序，严防暗器越界。
            </WuxiaPlaque>
          )}

          {report.variants.length > 1 && (
            <WuxiaPlaque variant="gold">
              <div style={{ fontWeight: 600, marginBottom: 10, color: "var(--accent-gold-bright)" }}>
                <Layers size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
                此卷内含 {report.variants.length} 路互斥剑式（变体），请择定其一：
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {report.variants.map((v) => {
                  const picked = selectedVariant === v.name;
                  return (
                    <div
                      key={v.name}
                      className={`variant-option-row ${picked ? "picked" : ""}`}
                      onClick={() => {
                        setSelectedVariant(v.name);
                        setAllowConflicts(false);
                        setAllowUncertain(false);
                      }}
                    >
                      <SealCheck
                        radio
                        checked={picked}
                        onChange={() => {
                          setSelectedVariant(v.name);
                          setAllowConflicts(false);
                          setAllowUncertain(false);
                        }}
                        label={<span style={{ fontWeight: 600 }}>{v.name}</span>}
                      />
                      <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
                        {v.categories.join(" / ")} · {v.files.length} 件器物
                      </span>
                    </div>
                  );
                })}
              </div>
            </WuxiaPlaque>
          )}

          {activeVariant && (
            <>
              <InkDivider label={`投递脉络 · ${activeVariant.name}`} />
              <WuxiaPlaque>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontWeight: 600 }}>归位路径清册</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    {activeVariant.categories.map((c) => (
                      <span key={c} className="wuxia-seal-tag gold">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="manifest-code-box mono">
                  {activeVariant.files.map((f, idx) => (
                    <div key={idx}>
                      [{f.target}] → {f.target_rel}
                      {f.is_user_config ? " (心法配置·升级保留)" : ""}
                    </div>
                  ))}
                </div>
                {activeVariant.containers.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-secondary)" }}>
                    已透视容器索引：{activeVariant.containers.length} 具（洞悉{" "}
                    {activeVariant.containers.reduce((acc, c) => acc + c.asset_paths.length, 0)} 条虚拟资产路径 /{" "}
                    {activeVariant.containers.reduce((acc, c) => acc + c.chunk_ids.length, 0)} 枚 IoStore 块指纹）
                  </div>
                )}
              </WuxiaPlaque>

              {activeVariant.warnings.map((w, i) => (
                <WuxiaPlaque key={i} variant="gold" style={{ padding: "10px 14px", fontSize: 12.5 }}>
                  <AlertTriangle size={14} color="#d9b477" style={{ verticalAlign: "-2px", marginRight: 6 }} />
                  {w}
                </WuxiaPlaque>
              ))}

              {activeVariant.problems.map((p, i) => (
                <WuxiaPlaque key={i} variant="crimson" style={{ padding: "10px 14px", fontSize: 12.5 }}>
                  <ShieldAlert size={14} color="#e25a61" style={{ verticalAlign: "-2px", marginRight: 6 }} />
                  杀气阻断：{p}
                </WuxiaPlaque>
              ))}

              {activeConflicts.length > 0 && (
                <WuxiaPlaque variant="crimson">
                  <div style={{ fontWeight: 600, color: "#f28b91", marginBottom: 6 }}>
                    检出 {activeConflicts.length} 处文件或容器资产相冲：
                  </div>
                  <ul style={{ paddingLeft: 18, fontSize: 12, color: "var(--text-primary)", marginBottom: 10 }}>
                    {activeConflicts.map((c, idx) => (
                      <li key={idx}>{c}</li>
                    ))}
                  </ul>
                  <SealCheck
                    checked={allowConflicts}
                    onChange={setAllowConflicts}
                    label="吾已知悉相冲覆盖之数，准予强行入匣"
                  />
                </WuxiaPlaque>
              )}

              {uncertainFiles.length > 0 && (
                <WuxiaPlaque variant="crimson">
                  <div style={{ fontWeight: 600, color: "#f28b91", marginBottom: 6 }}>
                    检出非常规命名的原生 DLL 机关：
                  </div>
                  <div className="mono" style={{ marginBottom: 8 }}>
                    {uncertainFiles.map((u) => u.target_rel).join(", ")}
                  </div>
                  <SealCheck
                    checked={allowUncertain}
                    onChange={setAllowUncertain}
                    label="信重此卷来历，准予置入游戏主程序目录"
                  />
                </WuxiaPlaque>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="wuxia-btn" onClick={onClose} disabled={busy}>
            暂收卷宗
          </button>
          <button
            className="wuxia-btn primary-crimson"
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
            {busy ? "正在铸印投递..." : "朱印准奏 · 入匣佩剑"}
          </button>
        </div>
      </div>
    </div>
  );
};
