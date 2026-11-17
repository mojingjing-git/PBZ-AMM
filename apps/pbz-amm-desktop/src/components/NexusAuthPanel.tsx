import React, { useState } from "react";
import { CheckCircle2, ExternalLink, KeyRound, Link2, ShieldCheck } from "lucide-react";
import { WuxiaPlaque } from "./WuxiaPrimitives";

export interface NexusAccountInfo {
  name: string;
  is_premium: boolean;
}

interface NexusAuthPanelProps {
  hasKey: boolean;
  nxmRegistered: boolean;
  account: NexusAccountInfo | null;
  busy: boolean;
  compactWhenBound?: boolean;
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
  compactWhenBound = false,
  agentId,
  highlighted = false,
  onOpenUrl,
  onBindKey,
  onRegisterNxm,
  onClearKey,
}) => {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [expanded, setExpanded] = useState(false);

  const accountBadge = account
    ? `${account.name}（${account.is_premium ? "会员 · 支持静默直连" : "免费账号 · 支持 nxm:// 网页接管"}）`
    : hasKey
      ? "密钥已存入系统凭据库"
      : "未绑定账号";

  if (compactWhenBound && hasKey && !expanded) {
    return (
      <WuxiaPlaque
        agentId={agentId}
        highlighted={highlighted}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <CheckCircle2 size={15} color="#4ea885" />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Nexus 账号：{accountBadge}</span>
          <span className={`wuxia-seal-tag ${nxmRegistered ? "jade" : "gold"}`}>
            {nxmRegistered ? "nxm:// 已就绪" : "nxm:// 未注册"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {!nxmRegistered && (
            <button className="wuxia-btn gold" disabled={busy} onClick={() => void onRegisterNxm()}>
              <Link2 size={13} />
              一键注册 nxm://
            </button>
          )}
          <button className="wuxia-btn" onClick={() => setExpanded(true)}>
            管理绑定
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
          <KeyRound size={15} color="#d9b477" />
          <span style={{ fontFamily: "var(--font-serif)", fontWeight: 700 }}>
            {hasKey
              ? "Nexus Mods 账号与 nxm:// 下载协议"
              : "绑定 Nexus Mods 账号（支持免费账号，3 步即可下载安装）"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className={`wuxia-seal-tag ${hasKey ? "jade" : "gold"}`}>{accountBadge}</span>
          <span className={`wuxia-seal-tag ${nxmRegistered ? "jade" : ""}`}>
            {nxmRegistered ? "nxm:// 已注册" : "nxm:// 未注册"}
          </span>
          {compactWhenBound && hasKey && (
            <button className="wuxia-btn-mini" onClick={() => setExpanded(false)}>
              收起
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
          <strong>第 1 步：</strong>点右侧按钮在浏览器登录 Nexus，拉到页面最底部{" "}
          <span className="mono" style={{ color: "var(--bronze-bright)" }}>
            Personal API Key
          </span>{" "}
          区域，点 <span className="mono">Request an API Key</span> 生成并复制密钥。
        </div>
        <div>
          <strong>第 2 步：</strong>把密钥粘贴到下方并点击「验证并绑定」（仅加密存于 Windows 凭据管理器，绝不明文落盘）。
        </div>
        <div>
          <strong>第 3 步（免费号说明）：</strong>绑定后在工坊点「下载预检」，软件会自动弹出<strong>内置轻量浏览窗</strong>（记住登录态、无需切外部浏览器）；你只需在窗内亲手点一下{" "}
          <span className="mono">Slow Download</span>，小窗即会自动关闭并接管安装。
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button
          className="wuxia-btn"
          disabled={busy}
          onClick={() => void onOpenUrl(NEXUS_API_KEY_URL)}
          title="在默认浏览器中打开 Nexus Personal API Key 页面"
        >
          <ExternalLink size={13} />
          打开 Nexus 获取密钥
        </button>

        <input
          type="password"
          className="wuxia-input"
          style={{ flex: 1, minWidth: 220 }}
          placeholder="粘贴 Nexus Personal API Key..."
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
          验证并绑定（自动开启 nxm://）
        </button>

        {!nxmRegistered && (
          <button className="wuxia-btn" disabled={busy} onClick={() => void onRegisterNxm()}>
            仅注册 nxm://
          </button>
        )}

        {hasKey && (
          <button className="wuxia-btn primary-crimson" disabled={busy} onClick={() => void onClearKey()}>
            清除密钥
          </button>
        )}
      </div>
    </WuxiaPlaque>
  );
};
