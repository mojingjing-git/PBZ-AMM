import React, { useState } from "react";
import { AlertTriangle, CheckCircle2, Layers, ShieldAlert, X } from "lucide-react";
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
            <img src="/assets/seal-emblem.png" alt="" width={32} height={32} />
            <div>
              <h2>安装预检 · {report.suggested_name}</h2>
              {triggeredByAgent && (
                <div style={{ fontSize: 11.5, color: "var(--cinnabar-text)", marginTop: 2 }}>
                  已同步 CLI / Agent 预检结果：可直接在此选择并完成安装，也可回到命令行继续确认
                </div>
              )}
            </div>
          </div>
          <button className="wuxia-btn" onClick={onClose} style={{ padding: "4px 9px" }}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div style={{ fontSize: 12, color: "var(--parchment-dim)" }}>
            来源路径：<span className="mono">{source_path}</span>
            {(nexusIdOverride || report.nexus_mod_id_hint) && (
              <span className="wuxia-seal-tag gold" style={{ marginLeft: 8 }}>
                Nexus #{nexusIdOverride ?? report.nexus_mod_id_hint}
              </span>
            )}
          </div>

          {report.ignored_executables.length > 0 && (
            <WuxiaPlaque variant="gold" style={{ padding: "10px 14px", fontSize: 12 }}>
              <span style={{ color: "var(--bronze-bright)", fontWeight: 600 }}>
                安全提示：
              </span>
              已自动忽略包内附带的 {report.ignored_executables.length} 个可执行文件/脚本（不会运行任何外部程序）。
            </WuxiaPlaque>
          )}

          {report.variants.length > 1 && (
            <WuxiaPlaque variant="gold">
              <div style={{ fontWeight: 600, marginBottom: 10, color: "var(--bronze-bright)" }}>
                <Layers size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
                检测到 {report.variants.length} 个互斥可选版本（变体），请选择要安装的一项：
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
                      <span style={{ fontSize: 11.5, color: "var(--parchment-dim)" }}>
                        {v.categories.join(" / ")} · {v.files.length} 个文件
                      </span>
                    </div>
                  );
                })}
              </div>
            </WuxiaPlaque>
          )}

          {activeVariant && (
            <>
              <InkDivider label={`文件部署预览 · ${activeVariant.name}`} />
              <WuxiaPlaque>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontWeight: 600 }}>目标位置清单</span>
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
                      {f.is_user_config ? " (配置文件·更新时自动保留)" : ""}
                    </div>
                  ))}
                </div>
                {activeVariant.containers.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "var(--parchment-dim)" }}>
                    已解析容器包：{activeVariant.containers.length} 个（共扫描{" "}
                    {activeVariant.containers.reduce((acc, c) => acc + c.asset_paths.length, 0)} 条内部资产路径 /{" "}
                    {activeVariant.containers.reduce((acc, c) => acc + c.chunk_ids.length, 0)} 个 IoStore 数据块）
                  </div>
                )}
              </WuxiaPlaque>

              {activeVariant.warnings.map((w, i) => (
                <WuxiaPlaque key={i} variant="gold" style={{ padding: "10px 14px", fontSize: 12.5 }}>
                  <AlertTriangle size={14} color="var(--icon-bronze)" style={{ verticalAlign: "-2px", marginRight: 6 }} />
                  {w}
                </WuxiaPlaque>
              ))}

              {activeVariant.problems.map((p, i) => (
                <WuxiaPlaque key={i} variant="crimson" style={{ padding: "10px 14px", fontSize: 12.5 }}>
                  <ShieldAlert size={14} color="var(--cinnabar-bright)" style={{ verticalAlign: "-2px", marginRight: 6 }} />
                  无法安装：{p}
                </WuxiaPlaque>
              ))}

              {activeConflicts.length > 0 && (
                <WuxiaPlaque variant="crimson">
                  <div style={{ fontWeight: 600, color: "var(--cinnabar-text)", marginBottom: 6 }}>
                    检测到 {activeConflicts.length} 项文件或内部资产冲突：
                  </div>
                  <ul style={{ paddingLeft: 18, fontSize: 12, color: "var(--parchment-main)", marginBottom: 10 }}>
                    {activeConflicts.map((c, idx) => (
                      <li key={idx}>{c}</li>
                    ))}
                  </ul>
                  <SealCheck
                    checked={allowConflicts}
                    onChange={setAllowConflicts}
                    label="我已了解上述覆盖关系，确认继续安装"
                  />
                </WuxiaPlaque>
              )}

              {uncertainFiles.length > 0 && (
                <WuxiaPlaque variant="crimson">
                  <div style={{ fontWeight: 600, color: "var(--cinnabar-text)", marginBottom: 6 }}>
                    包含未识别用途的 DLL 文件：
                  </div>
                  <div className="mono" style={{ marginBottom: 8 }}>
                    {uncertainFiles.map((u) => u.target_rel).join(", ")}
                  </div>
                  <SealCheck
                    checked={allowUncertain}
                    onChange={setAllowUncertain}
                    label="信任此文件来源并允许放入游戏目录"
                  />
                </WuxiaPlaque>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="wuxia-btn" onClick={onClose} disabled={busy}>
            取消
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
            <CheckCircle2 size={14} />
            {busy ? "正在安装..." : "确认安装并启用"}
          </button>
        </div>
      </div>
    </div>
  );
};
