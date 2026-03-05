import { useState, useEffect } from "react";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const GOOGLE_REDIRECT = window.location.origin;
const SCOPES = "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive.readonly";
const SLACK_CLIENT_ID = import.meta.env.VITE_SLACK_CLIENT_ID;
const SLACK_USER_SCOPES = "channels:read,channels:history,groups:read,groups:history,chat:write,users:read,im:read,im:write,im:history";
const MS_CLIENT_ID = import.meta.env.VITE_MS_CLIENT_ID;
const MS_SCOPES = "Mail.Read Calendars.ReadWrite User.Read Sites.Read.All Files.Read.All Chat.Read Team.ReadBasic.All Channel.ReadBasic.All ChannelMessage.Read.All";

export function googleAuthUrl() {
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

export function slackAuthUrl() {
  return (
    "https://slack.com/oauth/v2/authorize?" +
    new URLSearchParams({
      client_id: SLACK_CLIENT_ID,
      user_scope: SLACK_USER_SCOPES,
      redirect_uri: window.location.origin,
      state: "slack",
    })
  );
}

export function msAuthUrl() {
  return (
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?" +
    new URLSearchParams({
      client_id: MS_CLIENT_ID,
      redirect_uri: window.location.origin,
      response_type: "code",
      scope: MS_SCOPES,
      state: "ms",
      prompt: "consent",
    })
  );
}

export default function useAuth() {
  const [token, setToken] = useState(localStorage.getItem("g_token") || "");
  const [googleEmail, setGoogleEmail] = useState(localStorage.getItem("g_email") || "");
  const [slackConnected, setSlackConnected] = useState(false);
  const [slackToken, setSlackToken] = useState(localStorage.getItem("slack_token"));
  const [slackEmail, setSlackEmail] = useState(localStorage.getItem("slack_email") || "");
  const [msToken, setMsToken] = useState(localStorage.getItem("ms_token") || "");
  const [msEmail, setMsEmail] = useState(localStorage.getItem("ms_email") || "");

  // Google OAuth hash fragment handler
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

  // Slack + MS OAuth callback handler
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (code && state === "ms") {
      fetch(
        "/api/ms-oauth?code=" +
          code +
          "&redirect_uri=" +
          encodeURIComponent(window.location.origin)
      )
        .then((r) => r.json())
        .then((data) => {
          if (data.ok && data.access_token) {
            localStorage.setItem("ms_token", data.access_token);
            setMsToken(data.access_token);
            window.history.replaceState({}, "", window.location.pathname);
          }
        });
    } else if (code && !params.get("access_token")) {
      fetch(
        "/api/slack-oauth?code=" +
          code +
          "&redirect_uri=" +
          encodeURIComponent(window.location.origin)
      )
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

  const logout = () => {
    localStorage.removeItem("g_token");
    localStorage.removeItem("g_email");
    setToken("");
    setGoogleEmail("");
  };

  const slackLogout = () => {
    localStorage.removeItem("slack_token");
    localStorage.removeItem("slack_email");
    setSlackToken(null);
    setSlackConnected(false);
    setSlackEmail("");
  };

  const msLogout = () => {
    localStorage.removeItem("ms_token");
    localStorage.removeItem("ms_email");
    setMsToken("");
    setMsEmail("");
  };

  return {
    token,
    setToken,
    googleEmail,
    setGoogleEmail,
    slackConnected,
    setSlackConnected,
    slackToken,
    setSlackToken,
    slackEmail,
    setSlackEmail,
    msToken,
    setMsToken,
    msEmail,
    setMsEmail,
    logout,
    slackLogout,
    msLogout,
  };
}
