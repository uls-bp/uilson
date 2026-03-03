import { useState, useEffect, useRef } from "react";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const GOOGLE_REDIRECT = window.location.origin;
const SCOPES =
  "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar";

const SLACK_CLIENT_ID = import.meta.env.VITE_SLACK_CLIENT_ID;
const SLACK_USER_SCOPES = "channels:read,channels:history,groups:read,groups:history,chat:write,users:read";

function slackAuthUrl() {
  return (
    "https://slack.com/oauth/v2/authorize?" +
    new URLSearchParams({
      client_id: SLACK_CLIENT_ID,
      user_scope: SLACK_USER_SCOPES,
      redirect_uri: window.location.origin,
    })
  );
}

function googleAuthUrl() {
  return (
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT,
      response_type: "token",
      scope: SCOPES,
      prompt: "consent",
    })
  );
}

async function fetchGmail(token) {
  const res = await fetch(
    (() => { const d = new Date(); d.setMonth(d.getMonth() - 2); return "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q=after:" + d.getFullYear() + "/" + (d.getMonth()+1) + "/" + d.getDate(); })(),
    { headers: { Authorization: "Bearer " + token } }
  );
  if (res.status === 401) throw new Error("AUTH_EXPIRED");
    const data = await res.json();
  if (!data.messages) return [];
  const details = await Promise.all(
    data.messages.slice(0, 50).map((m) =>
      fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/" +
          m.id +
          "?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date",
        { headers: { Authorization: "Bearer " + token } }
      ).then((r) => r.json())
    )
  );
  return details.map((d) => {
    const h = (n) =>
      (d.payload?.headers || []).find((x) => x.name === n)?.value || "";
    return {
      id: d.id,
      subject: h("Subject"),
      from: h("From"),
      date: h("Date"),
      snippet: d.snippet,
    };
  });
}

async function fetchCalendar(token) {
  const headers = { Authorization: "Bearer " + token };
  const now = new Date().toISOString();

  // 1. Get all calendars the user has access to (including shared / sub-account)
  let calendarIds = ["primary"];
  try {
    const listRes = await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList",
      { headers }
    );
    if (listRes.status === 401) throw new Error("AUTH_EXPIRED");
    const listData = await listRes.json();
    if (listData.items && listData.items.length) {
      calendarIds = listData.items
        .filter((c) => c.selected !== false)
        .map((c) => c.id);
    }
  } catch {}

  // 2. Fetch events from every calendar in parallel
  const allEvents = await Promise.all(
    calendarIds.map(async (calId) => {
      try {
        const res = await fetch(
          "https://www.googleapis.com/calendar/v3/calendars/" +
            encodeURIComponent(calId) +
            "/events?maxResults=250&timeMin=" +
          new Date().toISOString() +
          "&orderBy=startTime&singleEvents=true",
          { headers }
        );
        const data = await res.json();
        return (data.items || []).map((e) => ({
          id: e.id,
          summary: e.summary,
          start: e.start?.dateTime || e.start?.date,
          end: e.end?.dateTime || e.end?.date,
          location: e.location || "",
          calendar: e.organizer?.displayName || calId,
        }));
      } catch {
        return [];
      }
    })
  );

  // 3. Flatten, deduplicate by summary+start, and sort by start time
  const seen = new Set();
  return allEvents
    .flat()
    .filter((e) => {
      const key = (e.summary || "") + "|" + (e.start || "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.start || "").localeCompare(b.start || ""))
    .slice(0, 200);
}

async function fetchSlack(tk) {
  if (!tk) return { connected: false, messages: [] };
  try {
    const url = "/api/slack-messages?token=" + encodeURIComponent(tk);
    const res = await fetch(url);
    const data = await res.json();
    if (data.connected)
      return { connected: true, messages: data.messages || [] };
    return { connected: false, messages: [] };
  } catch {
    return { connected: false, messages: [] };
  }
}

function extractReply(data) {
  if (Array.isArray(data.content)) {
    return data.content.map((c) => c.text || "").join("");
  }
  if (typeof data.content === "string") return data.content;
  if (data.error) {
    if (typeof data.error === "string") return data.error;
    if (data.error.message) return data.error.message;
    return JSON.stringify(data.error);
  }
  if (data.message) return data.message;
  return "Error: unexpected response";
}

function buildContext(emails, events, slackMsgs) {
  let ctx = "";
  if (emails.length) {
    ctx += "\n## Gmail (latest " + emails.length + ")\n";
    emails.forEach((e) => {
      ctx +=
        "- [ID:" + e.id + "] From:" +
        e.from +
        " Sub:" +
        e.subject +
        " Date:" +
        e.date +
        " Snippet:" +
        e.snippet +
        "\n";
    });
  }
  if (events.length) {
    ctx += "\n## Calendar (upcoming " + events.length + ")\n";
    events.forEach((e) => {
      ctx +=
        "- [ID:" + e.id + "] " +
        e.summary +
        " " +
        e.start +
        " ~ " +
        e.end +
        (e.location ? " @" + e.location : "") +
        (e.calendar ? " [" + e.calendar + "]" : "") +
        "\n";
    });
  }
  if (slackMsgs && slackMsgs.length) {
    ctx += "\n## Slack (latest " + slackMsgs.length + ")\n";
    slackMsgs.forEach((m) => {
      ctx +=
        "- #" +
        m.channel +
        " " +
        m.userName +
        ": " +
        m.text +
        " (" +
        m.date +
        ")\n";
    });
  }
  return ctx;
}

/* ─── V16 Design System ─── */
const V = {
  bg: "#F0F2F7",
  sb: "#FFFFFF",
  main: "#F5F6FA",
  card: "#FFFFFF",
  border: "#DDE1EB",
  border2: "#C8CDD8",
  t1: "#333333",
  t2: "#555555",
  t3: "#888888",
  t4: "#AAAAAA",
  white: "#FFFFFF",
  accent: "#3C5996",
  teal: "#2B4070",
  navy: "#1E2D50",
  blue: "#3C5996",
  red: "#C83732",
  green: "#2E7D32",
  orange: "#D4880F",
  lime: "#ABCD00",
};

const globalCSS = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;600;700;800&display=swap');
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:'Noto Sans JP',-apple-system,sans-serif; background:${V.bg}; overflow:hidden; }
::-webkit-scrollbar { width:6px; }
::-webkit-scrollbar-thumb { background:${V.border2}; border-radius:3px; }
::-webkit-scrollbar-track { background:transparent; }
@keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
.fi { animation: fadeIn 0.3s ease forwards; }

@media(max-width:768px){
  .uilson-sb { display:none !important; }
  .uilson-mn { width:100% !important; }
}
`;

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("g_token") || "");
  const [emails, setEmails] = useState([]);
  const [events, setEvents] = useState([]);
  const [googleEmail, setGoogleEmail] = useState(localStorage.getItem("g_email") || "");
  const [slackConnected, setSlackConnected] = useState(false);
  const [slackToken, setSlackToken] = useState(localStorage.getItem("slack_token"));
  const [slackMsgs, setSlackMsgs] = useState([]);
  const [slackEmail, setSlackEmail] = useState(localStorage.getItem("slack_email") || "");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState("chat");
  const [sbCollapsed, setSbCollapsed] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("access_token")) {
      const t = new URLSearchParams(hash.substring(1)).get("access_token");
      if (t) {
        localStorage.setItem("g_token", t);
        setToken(t);
        window.history.replaceState(null, "", window.location.pathname);
      }
    }
  }, []);

  useEffect(() => {
    if (token) {
      fetchGmail(token).then(setEmails).catch((e) => {
        console.error(e);
        if (e.message === "AUTH_EXPIRED") { localStorage.removeItem("g_token"); setToken(null); }
      });
      fetchCalendar(token).then(setEvents).catch((e) => {
        console.error(e);
        if (e.message === "AUTH_EXPIRED") { localStorage.removeItem("g_token"); setToken(null); }
      });
      // Fetch Google email
      fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers: { Authorization: "Bearer " + token },
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.emailAddress) {
            setGoogleEmail(d.emailAddress);
            localStorage.setItem("g_email", d.emailAddress);
          }
        })
        .catch(console.error);
    }
  }, [token]);


  // Slack OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code && !params.get("access_token")) {
      fetch("/api/slack-oauth?code=" + code + "&redirect_uri=" + encodeURIComponent(window.location.origin))
        .then((r) => r.json())
        .then((data) => {
          if (data.ok && data.access_token) {
            localStorage.setItem("slack_token", data.access_token);
            setSlackToken(data.access_token);
            window.history.replaceState({}, "", window.location.pathname);
          }
        });
    }
  }, []);

  useEffect(() => {
    if (slackToken) {
      fetchSlack(slackToken)
        .then((r) => {
          setSlackConnected(r.connected);
          setSlackMsgs(r.messages);
        })
        .catch(console.error);
    }
    // Fetch Slack user email
    if (slackToken) {
      fetch("/api/slack-userinfo?token=" + encodeURIComponent(slackToken))
        .then((r) => r.json())
        .then((d) => {
          if (d.ok) {
            const info = d.email || (d.user ? d.user + " @ " + (d.team || "Slack") : null);
            if (info) {
              setSlackEmail(info);
              localStorage.setItem("slack_email", info);
            }
          }
        })
        .catch(console.error);
    }
  }, [slackToken]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const getContext = async () => {
    let e = emails,
      ev = events,
      sm = slackMsgs;
    if (token) {
      try {
        e = await fetchGmail(token);
        setEmails(e);
        ev = await fetchCalendar(token);
        setEvents(ev);
      } catch {}
    }
    try {
      const r = await fetchSlack(slackToken);
      sm = r.messages;
      setSlackMsgs(sm);
      setSlackConnected(r.connected);
    } catch {}
    return buildContext(e, ev, sm);
  };

  const send = async (text) => {
    if (!text.trim()) return;
    const userMsg = { role: "user", content: text };
    setMessages((p) => [...p, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const ctx = await getContext();
      const systemPrompt =
        "You are UILSON, a professional AI business assistant. Current: " +
        new Date().toLocaleString("ja-JP") +
        "\nUser data:" +
        ctx +
        "\nReply in user language. For greetings, give a brief daily briefing using Gmail, Calendar, and Slack data.";
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg]
            .slice(-20)
            .map((m) => ({ role: m.role, content: m.content })),
          system: systemPrompt,
          googleToken: token,
        }),
      });
      const data = await res.json();
      const reply = extractReply(data);
      setMessages((p) => [...p, { role: "assistant", content: reply }]);
    } catch (err) {
      setMessages((p) => [
        ...p,
        { role: "assistant", content: "Error: " + err.message },
      ]);
    }
    setLoading(false);
  };

  const quickActions = [
    {
      label: "☀️ 今日のブリーフィング",
      text: "おはよう！今日のブリーフィングをください。",
    },
    {
      label: "✉️ 未読メール",
      text: "未読メールを要約してください。",
    },
    {
      label: "📅 今日の予定",
      text: "今日のカレンダーの予定は？",
    },
    {
      label: "💬 Slackメッセージ",
      text: "最近のSlackメッセージを見せて。",
    },
  ];

  const logout = () => {
    localStorage.removeItem("g_token");
    localStorage.removeItem("g_email");
    setToken("");
    setEmails([]);
    setEvents([]);
    setGoogleEmail("");
  };

  /* ─── Sidebar Nav Items ─── */
  const slackLogout = () => {
    localStorage.removeItem("slack_token");
    localStorage.removeItem("slack_email");
    setSlackToken(null);
    setSlackConnected(false);
    setSlackMsgs([]);
    setSlackEmail("");
  };

  const navItems = [
    { id: "chat", icon: "💬", label: "指示する" },
    { id: "settings", icon: "⚙️", label: "設定" },
  ];

  return (
    <>
      <style>{globalCSS}</style>
      <div style={{ display: "flex", height: "100vh", background: V.bg, color: V.t1 }}>
        {/* ─── Sidebar ─── */}
        <div
          className="uilson-sb"
          style={{
            width: sbCollapsed ? 56 : 220,
            background: V.sb,
            borderRight: `1px solid ${V.border}`,
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            userSelect: "none",
            transition: "width 0.2s ease",
            overflow: "hidden",
          }}
        >
          {/* Logo */}
          <div
            style={{
              padding: sbCollapsed ? "14px 8px" : "18px 16px 14px",
              display: "flex",
              alignItems: "center",
              gap: 10,
              borderBottom: `1px solid ${V.border}`,
              justifyContent: sbCollapsed ? "center" : "flex-start",
            }}
          >
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                background: `linear-gradient(135deg, ${V.teal}, ${V.accent})`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 16,
                fontWeight: 800,
                color: V.white,
                position: "relative",
                flexShrink: 0,
              }}
            >
              U
              <span
                style={{
                  position: "absolute",
                  bottom: 3,
                  left: 5,
                  width: 9,
                  height: 2,
                  background: V.lime,
                  borderRadius: 1,
                }}
              />
            </div>
            {!sbCollapsed && (
              <div>
                <div
                  style={{
                    fontSize: 17,
                    fontWeight: 700,
                    color: V.accent,
                    letterSpacing: 1.5,
                  }}
                >
                  UILSON
                </div>
                <div style={{ fontSize: 11, color: V.t4, marginTop: 1 }}>
                  AI業務アシスタント
                </div>
              </div>
            )}
            {!sbCollapsed && (
              <div
                onClick={() => setSbCollapsed(true)}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  border: `1px solid ${V.border}`,
                  background: V.white,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  fontSize: 12,
                  color: V.t3,
                  marginLeft: "auto",
                  flexShrink: 0,
                }}
              >
                ◀
              </div>
            )}
            {sbCollapsed && (
              <div
                onClick={() => setSbCollapsed(false)}
                style={{
                  position: "absolute",
                  right: -12,
                  top: 22,
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  border: `1px solid ${V.border}`,
                  background: V.white,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  fontSize: 12,
                  color: V.t3,
                  zIndex: 10,
                }}
              >
                ▶
              </div>
            )}
          </div>

          {/* Nav */}
          <div style={{ flex: 1, padding: "10px 8px", overflowY: "auto" }}>
            {navItems.map((n) => (
              <div
                key={n.id}
                onClick={() => setView(n.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: sbCollapsed ? "12px 0" : "12px 14px",
                  borderRadius: 8,
                  cursor: "pointer",
                  transition: "all 0.12s",
                  position: "relative",
                  marginBottom: 2,
                  fontSize: 15,
                  color: view === n.id ? V.accent : V.t2,
                  fontWeight: view === n.id ? 600 : 500,
                  background:
                    view === n.id
                      ? "rgba(60,89,150,0.08)"
                      : "transparent",
                  justifyContent: sbCollapsed ? "center" : "flex-start",
                }}
              >
                {view === n.id && (
                  <span
                    style={{
                      position: "absolute",
                      left: 0,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 3,
                      height: 20,
                      borderRadius: "0 3px 3px 0",
                      background: V.lime,
                    }}
                  />
                )}
                <span style={{ fontSize: 19, flexShrink: 0, width: 22, textAlign: "center" }}>
                  {n.icon}
                </span>
                {!sbCollapsed && <span>{n.label}</span>}
              </div>
            ))}

            {/* Separator */}
            <div style={{ height: 1, background: V.border, margin: "10px 14px" }} />

            {/* Connection Status */}
            {!sbCollapsed && (
              <>
                <div
                  style={{
                    padding: "10px 14px 6px",
                    fontSize: 12,
                    color: V.t4,
                    fontWeight: 600,
                    letterSpacing: 0.5,
                  }}
                >
                  {"接続中のシステム"}
                </div>
                {[
                  { name: "Google", on: !!token },
                  { name: "Slack", on: slackConnected },
                ].map((c) => (
                  <div
                    key={c.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      padding: "3px 14px",
                      fontSize: 13,
                      color: V.t3,
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: c.on ? V.green : V.t4,
                        boxShadow: c.on
                          ? "0 0 4px rgba(46,125,50,0.3)"
                          : "none",
                      }}
                    />
                    <span>{c.name}</span>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* User area */}
          <div
            style={{
              padding: sbCollapsed ? "12px 8px" : "12px 14px",
              borderTop: `2px solid ${V.lime}`,
              display: "flex",
              alignItems: "center",
              gap: 9,
              justifyContent: sbCollapsed ? "center" : "flex-start",
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: `linear-gradient(135deg, ${V.teal}, ${V.accent})`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
                fontWeight: 600,
                color: V.white,
                flexShrink: 0,
              }}
            >
              M
            </div>
            {!sbCollapsed && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: V.t1 }}>Masataka</div>
                <div style={{ fontSize: 11, color: V.t4 }}>v2.0</div>
              </div>
            )}
          </div>
        </div>

        {/* ─── Main ─── */}
        <div
          className="uilson-mn"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            background: V.main,
          }}
        >
          {view === "settings" ? (
            /* ─── Settings View ─── */
            <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              <div
                style={{
                  padding: "12px 24px",
                  borderBottom: `1px solid ${V.border}`,
                  background: V.sb,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: V.t1 }}>
                    {"⚙️ 設定"}
                  </div>
                  <div style={{ fontSize: 14, color: V.t3, marginTop: 2 }}>
                    {"外部サービスの接続管理"}
                  </div>
                </div>
              </div>
              <div
                style={{                  flex: 1,
                  overflowY: "auto",
                  padding: "20px 24px",
                }}
              >
                {/* Google Card */}
                <div
                  style={{
                    background: V.card,
                    borderRadius: 10,
                    border: `1px solid ${V.border}`,
                    overflow: "hidden",
                    marginBottom: 14,
                    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                  }}
                >
                  <div
                    style={{
                      padding: "14px 16px",
                      borderBottom: `1px solid ${V.border}`,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 16,
                      fontWeight: 600,
                    }}
                  >
                    <span>
                      {"🌐"}
                    </span>{" "}
                    Googleアカウント
                  </div>
                  <div style={{ padding: 16 }}>
                    {token ? (
                      <>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            marginBottom: 12,
                          }}
                        >
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: V.green,
                              boxShadow: "0 0 4px rgba(46,125,50,0.3)",
                            }}
                          />
                          <span style={{ color: V.green, fontWeight: 600, fontSize: 14 }}>
                            {"接続済み"}
                          </span>
                          {googleEmail && (
                            <span style={{ fontSize: 13, color: V.t3, marginLeft: 8 }}>
                              ({googleEmail})
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 13, color: V.t3, marginBottom: 12 }}>
                          Gmail: {emails.length}件 / Calendar: {events.length}件
                        </div>
                        <button
                          onClick={logout}
                          style={{
                            padding: "8px 18px",
                            borderRadius: 7,
                            border: `1px solid ${V.red}`,
                            background: "transparent",
                            color: V.red,
                            fontSize: 14,
                            cursor: "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          {"切断"}
                        </button>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 14, color: V.t3, marginBottom: 12 }}>
                          {"未接続 — Gmailとカレンダーを連携します"}
                        </div>
                        <a
                          href={googleAuthUrl()}
                          style={{
                            display: "inline-block",
                            padding: "8px 18px",
                            borderRadius: 7,
                            border: "none",
                            background: `linear-gradient(135deg, ${V.accent}, #4A6BAE)`,
                            color: V.white,
                            fontSize: 15,
                            fontWeight: 600,
                            cursor: "pointer",
                            fontFamily: "inherit",
                            textDecoration: "none",
                          }}
                        >
                          Googleを接続
                        </a>
                      </>
                    )}
                  </div>
                </div>

                {/* Slack Card */}
                <div
                  style={{
                    background: V.card,
                    borderRadius: 10,
                    border: `1px solid ${V.border}`,
                    overflow: "hidden",
                    marginBottom: 14,
                    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                  }}
                >
                  <div
                    style={{
                      padding: "14px 16px",
                      borderBottom: `1px solid ${V.border}`,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 16,
                      fontWeight: 600,
                    }}
                  >
                    <span>
                      {"💬"}
                    </span>{" "}
                    Slack
                  </div>
                  <div style={{ padding: 16 }}>
                    {slackConnected ? (
                      <>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            marginBottom: 12,
                          }}
                        >
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: V.green,
                              boxShadow: "0 0 4px rgba(46,125,50,0.3)",
                            }}
                          />
                          <span style={{ color: V.green, fontWeight: 600, fontSize: 14 }}>
                            {"接続済み"}
                          </span>
                          {slackEmail && (
                            <span style={{ fontSize: 13, color: V.t3, marginLeft: 8 }}>
                              ({slackEmail})
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 13, color: V.t3 }}>
                          {slackMsgs.length}件のメッセージを取得
                        </div>
                      
                        <button
                          onClick={slackLogout}
                          style={{
                            padding: "8px 18px",
                            borderRadius: 7,
                            border: `1px solid ${V.red}`,
                            background: "transparent",
                            color: V.red,
                            fontSize: 14,
                            cursor: "pointer",
                            marginTop: 8,
                          }}
                        >
                          {"切断"}
                        </button>
                      </>
                    ) : (
                      <>
                      <div style={{ fontSize: 14, color: V.t3, marginBottom: 8 }}>
                        {"未接続"}
                      </div>
                      <a
                        href={slackAuthUrl()}
                        style={{
                          display: "inline-block",
                          padding: "8px 18px",
                          borderRadius: 7,
                          border: "none",
                          background: `linear-gradient(135deg, ${V.accent}, ${V.accent}cc)`,
                          color: "#fff",
                          fontSize: 14,
                          textDecoration: "none",
                          cursor: "pointer",
                        }}
                      >
                        {"Slackを接続"}
                      </a>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* ─── Chat View ─── */
            <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              {/* Top Bar */}
              <div
                style={{
                  padding: "12px 24px",
                  borderBottom: `1px solid ${V.border}`,
                  background: V.sb,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  flexShrink: 0,
                }}
              >
                <div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: V.t1 }}>
                    {"💬 指示する"}
                  </div>
                  <div style={{ fontSize: 14, color: V.t3, marginTop: 2 }}>
                    {"AIがメール・カレンダー・Slackを横断して判断します"}
                  </div>
                </div>
                <div
                  style={{
                    marginLeft: "auto",
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  {/* Connection dots */}
                  {[
                    { name: "Gmail", on: !!token },
                    { name: "Calendar", on: !!token },
                    { name: "Slack", on: slackConnected },
                  ].map((s) => (
                    <span
                      key={s.name}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 12,
                        color: s.on ? V.green : V.t4,
                        padding: "3px 8px",
                        borderRadius: 5,
                        background: s.on
                          ? "rgba(46,125,50,0.08)"
                          : V.main,
                        fontWeight: 600,
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: s.on ? V.green : V.t4,
                        }}
                      />
                      {s.name}
                    </span>
                  ))}
                </div>
              </div>

              {/* Chat Area */}
              <div
                style={{
                  flex: 1,
                  padding: 20,
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                {messages.length === 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      flex: 1,
                      gap: 20,
                    }}
                  >
                    {/* Logo */}
                    <div
                      style={{                     width: 64,
                        height: 64,
                        borderRadius: 16,
                        background: `linear-gradient(135deg, ${V.teal}, ${V.accent})`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 28,
                        fontWeight: 800,
                        color: V.white,
                        position: "relative",
                      }}
                    >
                      U
                      <span
                        style={{
                          position: "absolute",
                          bottom: 6,
                          left: 10,
                          width: 16,
                          height: 3,
                          background: V.lime,
                          borderRadius: 2,
                        }}
                      />
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div
                        style={{
                          fontSize: 22,
                          fontWeight: 700,
                          color: V.t1,
                          marginBottom: 6,
                        }}
                      >
                        UILSON
                      </div>
                      <div style={{ fontSize: 14, color: V.t3 }}>
                        {"AI業務アシスタント — 何でも聴いてください"}
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 10,
                        justifyContent: "center",
                        maxWidth: 500,
                      }}
                    >
                      {quickActions.map((a, i) => (
                        <button
                          key={i}
                          onClick={() => send(a.text)}
                          style={{
                            background: V.card,
                            border: `1px solid ${V.border}`,
                            color: V.t2,
                            borderRadius: 8,
                            padding: "10px 16px",
                            cursor: "pointer",
                            fontFamily: "inherit",
                            fontSize: 14,
                            fontWeight: 500,
                            transition: "all 0.15s",
                          }}
                          onMouseOver={(e) => {
                            e.currentTarget.style.borderColor = V.accent;
                            e.currentTarget.style.color = V.accent;
                            e.currentTarget.style.transform = "translateY(-1px)";
                          }}
                          onMouseOut={(e) => {
                            e.currentTarget.style.borderColor = V.border;
                            e.currentTarget.style.color = V.t2;
                            e.currentTarget.style.transform = "";
                          }}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((m, i) =>
                  m.role === "user" ? (
                    <div
                      key={i}
                      className="fi"
                      style={{ display: "flex", justifyContent: "flex-end" }}
                    >
                      <div
                        style={{
                          maxWidth: "55%",
                          background: `linear-gradient(135deg, ${V.accent}, ${V.teal})`,
                          borderRadius: "14px 14px 4px 14px",
                          padding: "12px 16px",
                          fontSize: 16,
                          lineHeight: 1.6,
                          color: V.white,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {m.content}
                      </div>
                    </div>
                  ) : (
                    <div
                      key={i}
                      className="fi"
                      style={{
                        display: "flex",
                        gap: 10,
                        maxWidth: "75%",
                      }}
                    >
                      <div
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: 7,
                          background: `linear-gradient(135deg, ${V.teal}, ${V.accent})`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 14,
                          fontWeight: 800,
                          color: V.white,
                          flexShrink: 0,
                        }}
                      >
                        U
                      </div>
                      <div
                        style={{
                          background: V.bg,
                          borderRadius: "4px 14px 14px 14px",
                          padding: "12px 16px",
                          border: `1px solid ${V.border}`,
                          fontSize: 15,
                          lineHeight: 1.7,
                          color: V.t1,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {m.content}
                      </div>
                    </div>
                  )
                )}

                {loading && (
                  <div style={{ display: "flex", gap: 10, maxWidth: "75%" }}>
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 7,
                        background: `linear-gradient(135deg, ${V.teal}, ${V.accent})`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 14,
                        fontWeight: 800,
                        color: V.white,
                        flexShrink: 0,
                      }}
                    >
                      U
                    </div>
                    <div
                      style={{
                        background: V.bg,
                        borderRadius: "4px 14px 14px 14px",
                        padding: "12px 16px",
                        border: `1px solid ${V.border}`,
                        fontSize: 15,
                        color: V.t3,
                      }}
                    >
                      <span style={{ animation: "pulse 1.2s ease-in-out infinite" }}>
                        {"🔍 情報を収集・分析中..."}
                      </span>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              {/* Input Bar */}
              <div
                style={{
                  padding: "12px 20px",
                  borderTop: `1px solid ${V.border}`,
                  background: V.sb,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    background: V.main,
                    borderRadius: 10,
                    padding: "5px 5px 5px 16px",
                    border: `1px solid ${V.border}`,
                    maxWidth: 800,
                    margin: "0 auto",
                  }}
                >
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.isComposing &&
                      e.keyCode !== 229 &&
                      send(input)
                    }
                    placeholder={"例：「今日の予定教えて」「未読メールを要約して」"}
                    style={{
                      flex: 1,
                      border: "none",
                      outline: "none",
                      background: "transparent",
                      color: V.t1,
                      fontSize: 15,
                      fontFamily: "inherit",
                    }}
                  />
                  <button
                    onClick={() => send(input)}
                    disabled={loading}
                    style={{
                      padding: "8px 20px",
                      borderRadius: 7,
                      border: "none",
                      background: `linear-gradient(135deg, ${V.accent}, #4A6BAE)`,
                      color: V.white,
                      fontSize: 15,
                      fontWeight: 600,
                      cursor: loading ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                      opacity: loading ? 0.6 : 1,
                    }}
                  >
                    {"送信 →"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}