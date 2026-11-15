import React, { useEffect, useState } from "react";
import { ScrollText, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { AgentActivityEvent } from "../types";

export interface CursorTargetStep {
  selector: string;
  caption?: string;
}

interface Ripple {
  id: number;
  x: number;
  y: number;
}

interface PuppeteerOverlayProps {
  activeBanner: { actor: string; summary: string; phase: string } | null;
  cursorPos: { x: number; y: number; striking: boolean } | null;
  ripples: Ripple[];
  events: AgentActivityEvent[];
  onRunShowcase: () => void;
}

export const PuppeteerOverlay: React.FC<PuppeteerOverlayProps> = ({
  activeBanner,
  cursorPos,
  ripples,
  events,
  onRunShowcase,
}) => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [winW, setWinW] = useState(() => window.innerWidth);

  useEffect(() => {
    const onResize = () => setWinW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const anchorX = winW * 0.52;
  // Pommel coordinates relative to top-left blade tip of puppeteer-cursor.png (88x60 rendered)
  const pommelX = (cursorPos?.x ?? anchorX) + 52;
  const pommelY = (cursorPos?.y ?? 90) + 36;

  const ctrlY = Math.max(40, pommelY * 0.42);
  const threadPathMain = `M ${anchorX} 0 Q ${(anchorX + pommelX) * 0.5 - 22} ${ctrlY}, ${pommelX} ${pommelY}`;
  const threadPathSub = `M ${anchorX + 28} 0 Q ${(anchorX + pommelX) * 0.5 + 18} ${ctrlY * 0.88}, ${pommelX + 10} ${pommelY + 7}`;

  const phaseBadge = (phase: string) => {
    switch (phase) {
      case "started":
        return <span className="wuxia-seal-tag gold">操演中</span>;
      case "succeeded":
        return <span className="wuxia-seal-tag jade">已成</span>;
      case "needs_selection":
        return <span className="wuxia-seal-tag crimson">待定夺</span>;
      default:
        return <span className="wuxia-seal-tag crimson">受阻</span>;
    }
  };

  return (
    <>
      {/* Top Unfurling Cinnabar-Ink Agent Banner */}
      {activeBanner && (
        <div className="puppeteer-top-banner">
          <div className="puppeteer-banner-inner">
            <span className="puppeteer-seal-chip">
              {activeBanner.actor.toUpperCase()} · 悬丝执剑
            </span>
            <span className="puppeteer-banner-text">{activeBanner.summary}</span>
            {phaseBadge(activeBanner.phase)}
          </div>
        </div>
      )}

      {/* Golden Silk Marionette Threads + Gliding Ceremonial Blade Cursor */}
      {cursorPos && (
        <div className="puppeteer-stage" aria-hidden="true">
          <svg className="puppeteer-threads-svg" width="100%" height="100%">
            <path d={threadPathMain} className="marionette-thread primary" />
            <path d={threadPathSub} className="marionette-thread secondary" />
            <circle cx={pommelX} cy={pommelY} r="2.8" fill="#f0d399" opacity="0.85" />
          </svg>

          {ripples.map((r) => (
            <div
              key={r.id}
              className="ink-strike-ripple"
              style={{ left: r.x, top: r.y }}
            />
          ))}

          <div
            className={`puppeteer-blade-cursor ${cursorPos.striking ? "striking" : ""}`}
            style={{
              transform: `translate3d(${cursorPos.x}px, ${cursorPos.y}px, 0) ${
                cursorPos.striking ? "scale(0.9) rotate(-9deg)" : "scale(1) rotate(0deg)"
              }`,
            }}
          >
            <img
              src="/assets/puppeteer-cursor.png"
              alt=""
              width={92}
              height={62}
              draggable={false}
            />
          </div>
        </div>
      )}

      {/* Collapsible Bottom-Right Live Activity Scroll ("机括留痕") */}
      <div className={`activity-scroll-dock ${drawerOpen ? "open" : ""}`}>
        <div className="activity-dock-header" onClick={() => setDrawerOpen((v) => !v)}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ScrollText size={14} color="#d9b477" />
            <span className="calligraphy-sub">机括留痕 · 悬丝实录</span>
            <span className="wuxia-seal-tag">{events.length}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              className="wuxia-btn-mini"
              onClick={(e) => {
                e.stopPropagation();
                onRunShowcase();
              }}
              title="演示「无形之手」悬丝游标巡检动效"
            >
              <Sparkles size={12} />
              演武试剑
            </button>
            {drawerOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </div>
        </div>

        {drawerOpen && (
          <div className="activity-dock-body">
            {events.length === 0 ? (
              <div className="activity-empty">
                尚无外部机括指令。当你在终端或 AI 对话中调用{" "}
                <span className="mono">pbz-amm</span> 时，悬丝剑指将在此实时同步操演。
              </div>
            ) : (
              events
                .slice()
                .reverse()
                .map((ev) => (
                  <div key={ev.id} className="activity-item">
                    <div className="activity-item-top">
                      <span className="mono" style={{ color: "var(--text-muted)", fontSize: 11 }}>
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
