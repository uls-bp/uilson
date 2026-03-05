import { useState } from "react";

const V = {
  bg: "#F0F2F7",
  sb: "#FFFFFF",
  main: "#F5F6FA",
  card: "#FFFFFF",
  border: "#DDE1EB",
  t1: "#333333",
  t2: "#555555",
  t3: "#888888",
  t4: "#AAAAAA",
  white: "#FFFFFF",
  accent: "#3C5996",
  teal: "#2B4070",
  lime: "#ABCD00",
  green: "#2E7D32",
  red: "#C83732"
};

const navItems = [
  { id: "create-menu", icon: "✏️", label: "作る" },
  { id: "chat", icon: "💬", label: "指示する" },
  {
    id: "learn",
    icon: "👁️",
    label: "学ばせる",
    badge: { text: "学習中", pulse: true, bg: "rgba(60,89,150,0.08)", color: "#3C5996" }
  },
  { id: "run", icon: "⚡", label: "動かす", badge: { text: "3", bg: "rgba(46,125,50,0.08)", color: "#2E7D32" } },
  { id: "review", icon: "📊", label: "振り返る" }
];

export default function Sidebar({
  view,
  setView,
  sbCollapsed,
  setSbCollapsed,
  token,
  slackConnected,
  msToken,
  onSettingsClick
}) {
  const isActive = (itemId) => view === itemId;

  return (
    <div
      className="uilson-sb"
      style={{
        width: sbCollapsed ? "56px" : "240px",
        height: "100vh",
        backgroundColor: V.sb,
        borderRight: `1px solid ${V.border}`,
        display: "flex",
        flexDirection: "column",
        transition: "width 0.2s ease",
        overflow: "hidden"
      }}
    >
      {/* Logo Area */}
      <div
        style={{
          padding: sbCollapsed ? "16px 8px" : "16px 20px",
          borderBottom: `1px solid ${V.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: sbCollapsed ? "center" : "space-between",
          gap: "12px"
        }}
      >
        {/* Logo Icon */}
        <div
          style={{
            width: "40px",
            height: "40px",
            borderRadius: "8px",
            background: `linear-gradient(135deg, ${V.teal} 0%, ${V.accent} 100%)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            flexShrink: 0
          }}
        >
          <span style={{ fontSize: "20px", fontWeight: "700", color: V.white }}>U</span>
          <div
            style={{
              position: "absolute",
              bottom: "-2px",
              left: "50%",
              transform: "translateX(-50%)",
              width: "20px",
              height: "2px",
              backgroundColor: V.lime
            }}
          />
        </div>

        {/* Logo Text */}
        {!sbCollapsed && (
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "16px", fontWeight: "700", color: V.t1, lineHeight: "1.2" }}>
              UILSON
            </div>
            <div style={{ fontSize: "11px", color: V.t3, lineHeight: "1.2" }}>
              AI業務アシスタント
            </div>
          </div>
        )}

        {/* Collapse Toggle */}
        <button
          onClick={() => setSbCollapsed(!sbCollapsed)}
          style={{
            width: "32px",
            height: "32px",
            border: "none",
            backgroundColor: "transparent",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: V.t3,
            fontSize: "18px",
            padding: 0
          }}
        >
          {sbCollapsed ? "→" : "←"}
        </button>
      </div>

      {/* Navigation Items */}
      <div style={{ flex: 1, padding: sbCollapsed ? "12px 4px" : "12px 8px", overflow: "hidden" }}>
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            style={{
              width: "100%",
              padding: sbCollapsed ? "12px 8px" : "12px 12px",
              marginBottom: "8px",
              border: "none",
              borderRadius: "8px",
              backgroundColor: isActive(item.id) ? `${V.accent}14` : "transparent",
              borderLeft: isActive(item.id) ? `3px solid ${V.lime}` : "3px solid transparent",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              transition: "all 0.2s ease",
              position: "relative"
            }}
          >
            <span style={{ fontSize: "20px", minWidth: "24px", textAlign: "center" }}>
              {item.icon}
            </span>

            {!sbCollapsed && (
              <>
                <span
                  style={{
                    fontSize: "14px",
                    fontWeight: isActive(item.id) ? "600" : "400",
                    color: isActive(item.id) ? V.accent : V.t2,
                    flex: 1,
                    textAlign: "left"
                  }}
                >
                  {item.label}
                </span>

                {item.badge && (
                  <div
                    style={{
                      backgroundColor: item.badge.bg,
                      color: item.badge.color,
                      fontSize: "11px",
                      fontWeight: "600",
                      padding: "2px 8px",
                      borderRadius: "4px",
                      whiteSpace: "nowrap",
                      animation: item.badge.pulse ? "pulse 2s infinite" : "none"
                    }}
                  >
                    {item.badge.text}
                  </div>
                )}
              </>
            )}

            {sbCollapsed && item.badge && (
              <div
                style={{
                  position: "absolute",
                  top: "-4px",
                  right: "-4px",
                  width: "20px",
                  height: "20px",
                  backgroundColor: item.badge.bg,
                  color: item.badge.color,
                  borderRadius: "10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "10px",
                  fontWeight: "700",
                  animation: item.badge.pulse ? "pulse 2s infinite" : "none"
                }}
              >
                {item.badge.text === "学習中" ? "●" : item.badge.text}
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Separator */}
      <div style={{ borderTop: `1px solid ${V.border}` }} />

      {/* Connected Systems Section */}
      {!sbCollapsed && (
        <div style={{ padding: "16px 20px" }}>
          <div
            style={{
              fontSize: "12px",
              fontWeight: "600",
              color: V.t3,
              marginBottom: "12px"
            }}
          >
            接続中のシステム
          </div>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            {/* Google */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "13px",
                color: V.t2
              }}
            >
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: token ? "#34A853" : V.t4
                }}
              />
              Google
            </div>

            {/* Slack */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "13px",
                color: V.t2
              }}
            >
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: slackConnected ? "#E01E5A" : V.t4
                }}
              />
              Slack
            </div>

            {/* Outlook */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "13px",
                color: V.t2
              }}
            >
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: msToken ? "#0078D4" : V.t4
                }}
              />
              Outlook
            </div>
          </div>
        </div>
      )}

      {/* Collapsed Systems Indicator */}
      {sbCollapsed && (
        <div style={{ padding: "12px 8px", display: "flex", justifyContent: "center", gap: "8px" }}>
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor: token ? "#34A853" : V.t4
            }}
          />
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor: slackConnected ? "#E01E5A" : V.t4
            }}
          />
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor: msToken ? "#0078D4" : V.t4
            }}
          />
        </div>
      )}

      {/* Legal Links */}
      {!sbCollapsed && (
        <div style={{ padding: "4px 20px", display: "flex", gap: "8px", justifyContent: "center" }}>
          <a href="/privacy.html" target="_blank" rel="noopener" style={{ fontSize: "10px", color: V.t4, textDecoration: "none" }}>プライバシーポリシー</a>
          <span style={{ fontSize: "10px", color: V.t4 }}>|</span>
          <a href="/terms.html" target="_blank" rel="noopener" style={{ fontSize: "10px", color: V.t4, textDecoration: "none" }}>利用規約</a>
        </div>
      )}

      {/* User Area */}
      <div
        style={{
          padding: sbCollapsed ? "12px 8px" : "12px 20px",
          borderTop: `1px solid ${V.border}`,
          display: "flex",
          alignItems: "center",
          gap: "12px"
        }}
      >
        <button
          onClick={onSettingsClick}
          style={{
            width: "40px",
            height: "40px",
            borderRadius: "8px",
            background: `linear-gradient(135deg, ${V.accent} 0%, ${V.teal} 100%)`,
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: V.white,
            fontWeight: "700",
            fontSize: "16px",
            flexShrink: 0
          }}
        >
          M
        </button>

        {!sbCollapsed && (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: "14px",
                fontWeight: "600",
                color: V.t1,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis"
              }}
            >
              Masataka
            </div>
            <div
              style={{
                fontSize: "11px",
                color: V.t3,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis"
              }}
            >
              v16.0
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}
