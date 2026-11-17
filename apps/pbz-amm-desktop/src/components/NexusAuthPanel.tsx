import React, { useState } from "react";
import { CheckCircle2, ExternalLink, KeyRound, Link2, ShieldCheck } from "lucide-react";
import { MESSAGES, UiLang } from "../i18n";
import { SealCheck, WuxiaPlaque } from "./WuxiaPrimitives";

export interface NexusAccountInfo {
  name: string;
  is_premium: boolean;
}

interface NexusAuthPanelProps {
  hasKey: boolean;
  nxmRegistered: boolean;
  account: NexusAccountInfo | null;
  busy: boolean;
  lang: UiLang;
  compactWhenBound?: boolean;
  useEmbeddedBrowser: boolean;
  onToggleEmbeddedBrowser: (val: boolean) => void;
  agentId?: string;
  highlighted?: boolean;
  onOpenUrl: (url: string) => Promise<void>;
  onBindKey: (apiKey: string) => Promise<boolean>;
  onRegisterNxm: () => Promise<void>;
  onClearKey: () => Promise<void>;
}

const NEXUS_API_KEY_URL = "https://www.nexusmods.com/users/myaccount?tab=api";

export const NexusAuthPanel: React.FC<NexusAuthPanelProps> = ({
  hasKey,
  nxmRegistered,
  account,
  busy,
  lang,
  compactWhenBound = false,
  useEmbeddedBrowser,
  onToggleEmbeddedBrowser,
  agentId,
  highlighted = false,
  onOpenUrl,
  onBindKey,
  onRegisterNxm,
  onClearKey,
}) => {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [expanded, setExpanded] = useState(false);
  const t = MESSAGES[lang].nexus.auth;
  const common = MESSAGES[lang].common;

  const accountBadge = account
    ? `${account.name} (${account.is_premium ? t.premiumAccount : t.freeAccount})`
    : hasKey
      ? t.keyStored
      : t.unbound;

  if (compactWhenBound && hasKey && !expanded) {
    return (
      <WuxiaPlaque
        agentId={agentId}
        highlighted={highlighted}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <CheckCircle2 size={15} color="var(--icon-jade)" />
          <span style={{ fontSize: 13, fontWeight: 600 }}>{t.accountPrefix}{accountBadge}</span>
          <span className={`wuxia-seal-tag ${nxmRegistered ? "jade" : "gold"}`}>
            {nxmRegistered ? t.nxmReady : t.nxmUnregistered}
          </span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <SealCheck
            checked={useEmbeddedBrowser}
            onChange={onToggleEmbeddedBrowser}
            label={t.embeddedCompactLabel}
          />
          {!nxmRegistered && (
            <button className="wuxia-btn gold" disabled={busy} onClick={() => void onRegisterNxm()}>
              <Link2 size={13} />
              {t.registerNxmOneClick}
            </button>
          )}
          <button className="wuxia-btn" onClick={() => setExpanded(true)}>
            {t.manageBinding}
          </button>
        </div>
      </WuxiaPlaque>
    );
  }

  return (
    <WuxiaPlaque agentId={agentId} variant={hasKey ? "default" : "gold"} highlighted={highlighted}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <KeyRound size={15} color="var(--icon-bronze)" />
          <span style={{ fontFamily: "var(--font-serif)", fontWeight: 700 }}>
            {hasKey ? t.headerBound : t.headerUnbound}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className={`wuxia-seal-tag ${hasKey ? "jade" : "gold"}`}>{accountBadge}</span>
          <span className={`wuxia-seal-tag ${nxmRegistered ? "jade" : ""}`}>
            {nxmRegistered ? t.nxmRegistered : t.nxmUnregistered}
          </span>
          {compactWhenBound && hasKey && (
            <button className="wuxia-btn-mini" onClick={() => setExpanded(false)}>
              {common.collapse}
            </button>
          )}
        </div>
      </div>

      <div
        style={{
          fontSize: 12.5,
          color: "var(--parchment-dim)",
          marginBottom: 10,
          display: "grid",
          gap: 4,
          lineHeight: 1.55,
        }}
      >
        <div>
          <strong>{t.step1Prefix}</strong>
          {t.step1BodyBeforeKey}
          <span className="mono" style={{ color: "var(--bronze-bright)" }}>
            Personal API Key
          </span>
          {t.step1BodyBetween}
          <span className="mono">Request an API Key</span>
          {t.step1BodyAfter}
        </div>
        <div>
          <strong>{t.step2Prefix}</strong>
          {t.step2Body}
        </div>
        <div>
          <strong>{t.step3Prefix}</strong>
          {t.step3BeforeStrong}
          <strong>{t.step3Strong}</strong>
          {t.step3Middle}
          <span className="mono">nxm://</span>
          {t.step3After}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button
          className="wuxia-btn"
          disabled={busy}
          onClick={() => void onOpenUrl(NEXUS_API_KEY_URL)}
          title={t.openKeyPageTitle}
        >
          <ExternalLink size={13} />
          {t.openKeyPageBtn}
        </button>

        <input
          type="password"
          className="wuxia-input"
          style={{ flex: 1, minWidth: 220 }}
          placeholder={t.keyPlaceholder}
          value={apiKeyInput}
          onChange={(e) => setApiKeyInput(e.target.value)}
        />

        <button
          className="wuxia-btn gold"
          disabled={busy}
          onClick={async () => {
            const ok = await onBindKey(apiKeyInput);
            if (ok) {
              setApiKeyInput("");
              setExpanded(false);
            }
          }}
        >
          <ShieldCheck size={13} />
          {t.bindBtn}
        </button>

        {!nxmRegistered && (
          <button className="wuxia-btn" disabled={busy} onClick={() => void onRegisterNxm()}>
            {t.registerOnlyBtn}
          </button>
        )}

        {hasKey && (
          <button className="wuxia-btn primary-crimson" disabled={busy} onClick={() => void onClearKey()}>
            {t.clearBtn}
          </button>
        )}
      </div>
      <div style={{ marginTop: 10 }}>
        <SealCheck
          checked={useEmbeddedBrowser}
          onChange={onToggleEmbeddedBrowser}
          label={t.embeddedFullLabel}
        />
      </div>
    </WuxiaPlaque>
  );
};
