import React, { useState } from "react";
import { AlertTriangle, CheckCircle2, Layers, ShieldAlert, X } from "lucide-react";
import { MESSAGES, UiLang } from "../i18n";
import { InspectPayload } from "../types";
import { InkDivider, SealCheck, WuxiaPlaque } from "./WuxiaPrimitives";

interface InspectModalProps {
  payload: InspectPayload;
  busy: boolean;
  lang: UiLang;
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
  lang,
  triggeredByAgent,
  nexusIdOverride,
  versionOverride,
  onClose,
  onConfirmInstall,
}) => {
  const m = MESSAGES[lang].inspectModal;
  const common = MESSAGES[lang].common;
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
              <h2>{m.titlePrefix}{report.suggested_name}</h2>
              {triggeredByAgent && (
                <div style={{ fontSize: 11.5, color: "var(--cinnabar-text)", marginTop: 2 }}>
                  {m.agentSynced}
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
            {m.sourcePath}<span className="mono">{source_path}</span>
            {(nexusIdOverride || report.nexus_mod_id_hint) && (
              <span className="wuxia-seal-tag gold" style={{ marginLeft: 8 }}>
                Nexus #{nexusIdOverride ?? report.nexus_mod_id_hint}
              </span>
            )}
          </div>

          {report.ignored_executables.length > 0 && (
            <WuxiaPlaque variant="gold" style={{ padding: "10px 14px", fontSize: 12 }}>
              <span style={{ color: "var(--bronze-bright)", fontWeight: 600 }}>
                {m.securityPrefix}
              </span>
              {m.securityBody(report.ignored_executables.length)}
            </WuxiaPlaque>
          )}

          {report.variants.length > 1 && (
            <WuxiaPlaque variant="gold">
              <div style={{ fontWeight: 600, marginBottom: 10, color: "var(--bronze-bright)" }}>
                <Layers size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
                {m.variantsPrompt(report.variants.length)}
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
                        {v.categories.join(" / ")} · {m.variantFileCount(v.files.length)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </WuxiaPlaque>
          )}

          {activeVariant && (
            <>
              <InkDivider label={`${m.deployPreviewPrefix}${activeVariant.name}`} />
              <WuxiaPlaque>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontWeight: 600 }}>{m.targetManifest}</span>
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
                      {f.is_user_config ? m.userConfigSuffix : ""}
                    </div>
                  ))}
                </div>
                {activeVariant.containers.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "var(--parchment-dim)" }}>
                    {m.containersSummary(
                      activeVariant.containers.length,
                      activeVariant.containers.reduce((acc, c) => acc + c.asset_paths.length, 0),
                      activeVariant.containers.reduce((acc, c) => acc + c.chunk_ids.length, 0)
                    )}
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
                  {m.blockingPrefix}{p}
                </WuxiaPlaque>
              ))}

              {activeConflicts.length > 0 && (
                <WuxiaPlaque variant="crimson">
                  <div style={{ fontWeight: 600, color: "var(--cinnabar-text)", marginBottom: 6 }}>
                    {m.conflictsDetected(activeConflicts.length)}
                  </div>
                  <ul style={{ paddingLeft: 18, fontSize: 12, color: "var(--parchment-main)", marginBottom: 10 }}>
                    {activeConflicts.map((c, idx) => (
                      <li key={idx}>{c}</li>
                    ))}
                  </ul>
                  <SealCheck
                    checked={allowConflicts}
                    onChange={setAllowConflicts}
                    label={m.allowConflictsLabel}
                  />
                </WuxiaPlaque>
              )}

              {uncertainFiles.length > 0 && (
                <WuxiaPlaque variant="crimson">
                  <div style={{ fontWeight: 600, color: "var(--cinnabar-text)", marginBottom: 6 }}>
                    {m.uncertainTitle}
                  </div>
                  <div className="mono" style={{ marginBottom: 8 }}>
                    {uncertainFiles.map((u) => u.target_rel).join(", ")}
                  </div>
                  <SealCheck
                    checked={allowUncertain}
                    onChange={setAllowUncertain}
                    label={m.allowUncertainLabel}
                  />
                </WuxiaPlaque>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="wuxia-btn" onClick={onClose} disabled={busy}>
            {common.cancel}
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
            {busy ? m.installing : m.confirmInstall}
          </button>
        </div>
      </div>
    </div>
  );
};
