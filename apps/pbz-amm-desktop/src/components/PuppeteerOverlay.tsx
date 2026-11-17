import React, { useState } from "react";
import { ChevronDown, ChevronUp, Terminal } from "lucide-react";
import { MESSAGES, UiLang } from "../i18n";
import { AgentActivityEvent } from "../types";

interface PuppeteerOverlayProps {
  activeBanner: { actor: string; summary: string; phase: string } | null;
  events: AgentActivityEvent[];
  lang: UiLang;
}

export const PuppeteerOverlay: React.FC<PuppeteerOverlayProps> = ({
  activeBanner,
  events,
  lang,
}) => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const t = MESSAGES[lang].overlay;

  const phaseBadge = (phase: string) => {
    switch (phase) {
      case "started":
        return <span className="wuxia-seal-tag gold">{t.started}</span>;
      case "succeeded":
        return <span className="wuxia-seal-tag jade">{t.succeeded}</span>;
      case "needs_selection":
        return <span className="wuxia-seal-tag crimson">{t.needsSelection}</span>;
      default:
        return <span className="wuxia-seal-tag crimson">{t.failed}</span>;
    }
  };

  return (
    <>
      {/* Clean Top Live Sync Status Pill (1 + A) */}
      {activeBanner && (
        <div className="puppeteer-top-banner">
          <div className="puppeteer-banner-inner">
            <span className="puppeteer-seal-chip">
              {t.syncing(activeBanner.actor)}
            </span>
            <span className="puppeteer-banner-text">{activeBanner.summary}</span>
            {phaseBadge(activeBanner.phase)}
          </div>
        </div>
      )}

      {/* Collapsible Bottom-Right Live Activity Log */}
      <div className={`activity-scroll-dock ${drawerOpen ? "open" : ""}`}>
        <div className="activity-dock-header" onClick={() => setDrawerOpen((v) => !v)}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Terminal size={14} color="var(--icon-bronze)" />
            <span className="calligraphy-sub">{t.drawerTitle}</span>
            <span className="wuxia-seal-tag">{events.length}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {drawerOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </div>
        </div>

        {drawerOpen && (
          <div className="activity-dock-body">
            {events.length === 0 ? (
              <div className="activity-empty">
                {t.emptyBeforeCmd}
                <span className="mono">pbz-amm</span>
                {t.emptyAfterCmd}
              </div>
            ) : (
              events
                .slice()
                .reverse()
                .map((ev) => (
                  <div key={ev.id} className="activity-item">
                    <div className="activity-item-top">
                      <span className="mono" style={{ color: "var(--parchment-muted)", fontSize: 11 }}>
                        {ev.timestamp}
                      </span>
                      <span className="wuxia-seal-tag">{ev.actor.toUpperCase()}</span>
                      {phaseBadge(ev.phase)}
                    </div>
                    <div className="activity-item-msg">{ev.summary}</div>
                  </div>
                ))
            )}
          </div>
        )}
      </div>
    </>
  );
};
