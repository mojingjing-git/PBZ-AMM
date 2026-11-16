import React from "react";

/**
 * Hidden global SVG definitions providing traditional ink-bleed displacement
 * and antique bronze metallic gradients inspired by shuimo-ui & Wuxia game UIs.
 */
export const SvgInkDefs: React.FC = () => (
  <svg width="0" height="0" style={{ position: "absolute", pointerEvents: "none" }} aria-hidden="true">
    <defs>
      <filter id="wuxia-ink-edge" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="3" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <linearGradient id="bronze-grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#e3c38d" />
        <stop offset="50%" stopColor="#b58d52" />
        <stop offset="100%" stopColor="#75562c" />
      </linearGradient>
      <linearGradient id="cinnabar-grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#df434a" />
        <stop offset="100%" stopColor="#86191e" />
      </linearGradient>
    </defs>
  </svg>
);

const CornerBracket: React.FC<{ pos: "tl" | "tr" | "bl" | "br"; crimson?: boolean }> = ({
  pos,
  crimson,
}) => {
  const transforms: Record<string, string> = {
    tl: "none",
    tr: "scaleX(-1)",
    bl: "scaleY(-1)",
    br: "scale(-1, -1)",
  };
  const stroke = crimson ? "#c93b42" : "#c69e63";
  return (
    <svg
      className={`corner-ornament ${pos}`}
      width="18"
      height="18"
      viewBox="0 0 18 18"
      style={{ transform: transforms[pos] }}
      aria-hidden="true"
    >
      <path
        d="M1 17 V4 L4 1 H17 M4 8 V4 H8"
        fill="none"
        stroke={stroke}
        strokeWidth="1.25"
        strokeOpacity="0.82"
      />
      <rect x="2.5" y="2.5" width="2.2" height="2.2" fill={stroke} opacity="0.7" />
    </svg>
  );
};

interface WuxiaPlaqueProps {
  children: React.ReactNode;
  variant?: "default" | "gold" | "crimson";
  highlighted?: boolean;
  className?: string;
  style?: React.CSSProperties;
  agentId?: string;
}

export const WuxiaPlaque: React.FC<WuxiaPlaqueProps> = ({
  children,
  variant = "default",
  highlighted = false,
  className = "",
  style,
  agentId,
}) => {
  const isCrimson = variant === "crimson";
  return (
    <div
      data-agent-id={agentId}
      className={`wuxia-plaque ${variant} ${highlighted ? "agent-pulse" : ""} ${className}`}
      style={style}
    >
      <CornerBracket pos="tl" crimson={isCrimson} />
      <CornerBracket pos="tr" crimson={isCrimson} />
      <CornerBracket pos="bl" crimson={isCrimson} />
      <CornerBracket pos="br" crimson={isCrimson} />
      {children}
    </div>
  );
};

interface LozengeSwitchProps {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  agentId?: string;
  title?: string;
}

/**
 * 45° rotated diamond bronze/cinnabar seal switch ("机括菱印开关"),
 * inspired by shuimo-ui's rotated core switch & Kungfu-Punk lockwork.
 */
export const LozengeSwitch: React.FC<LozengeSwitchProps> = ({
  checked,
  disabled,
  onChange,
  agentId,
  title,
}) => (
  <button
    type="button"
    data-agent-id={agentId}
    className={`lozenge-switch ${checked ? "on" : "off"} ${disabled ? "disabled" : ""}`}
    onClick={() => !disabled && onChange()}
    title={title}
    aria-pressed={checked}
  >
    <span className="lozenge-groove" />
    <span className="lozenge-label">{checked ? "开" : "关"}</span>
    <span className="lozenge-diamond">
      <span className="lozenge-inner-dot" />
    </span>
  </button>
);

interface SealCheckProps {
  checked: boolean;
  radio?: boolean;
  onChange: (next: boolean) => void;
  label?: React.ReactNode;
}

/**
 * Custom carved diamond cinnabar tally replacing browser-native checkbox/radio.
 */
export const SealCheck: React.FC<SealCheckProps> = ({ checked, radio, onChange, label }) => (
  <label
    className={`seal-check-wrap ${checked ? "checked" : ""}`}
    onClick={(e) => {
      e.preventDefault();
      onChange(!checked);
    }}
  >
    <span className={`seal-check-box ${radio ? "round-jade" : ""}`}>
      {checked && <span className="seal-check-mark" />}
    </span>
    {label && <span className="seal-check-text">{label}</span>}
  </label>
);

export const InkDivider: React.FC<{ label?: string }> = ({ label }) => (
  <div className="ink-divider">
    <span className="ink-divider-line left" />
    <span className="ink-divider-ornament">{label ? `◆ ${label} ◆` : "◆"}</span>
    <span className="ink-divider-line right" />
  </div>
);
