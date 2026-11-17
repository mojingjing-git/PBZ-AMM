import React, { useState } from "react";
import { ChevronDown, ChevronUp, Terminal } from "lucide-react";
import { AgentActivityEvent } from "../types";

interface PuppeteerOverlayProps {
  activeBanner: { actor: string; summary: string; phase: string } | null;
  events: AgentActivityEvent[];
}

export const PuppeteerOverlay: React.FC<PuppeteerOverlayProps> = ({
  activeBanner,
  events,
}) => {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const phaseBadge = (phase: string) => {
    switch (phase) {
      case "started":
        return <span className="wuxia-seal-tag gold">执行中</span>;
      case "succeeded":
        return <span className="wuxia-seal-tag jade">已完成</span>;
      case "needs_selection":
        return <span className="wuxia-seal-tag crimson">待选择</span>;
      default:
        return <span className="wuxia-seal-tag crimson">失败</span>;
    }
  };

  return (
    <>
      {/* Clean Top Live Sync Status Pill (1 + A) */}
      {activeBanner && (
        <div className="puppeteer-top-banner">
          <div className="puppeteer-banner-inner">
            <span className="puppeteer-seal-chip">
              {activeBanner.actor.toUpperCase()} 同步中
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
            <span className="calligraphy-sub">CLI / Agent 操作记录</span>
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
                暂无外部命令记录。当你在终端或 AI 对话中调用{" "}
                <span className="mono">pbz-amm</span> 时，界面会自动切换对应页面并实时同步状态。
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
