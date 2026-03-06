import { useState, useEffect } from "react";

// Hardcoded UILSON project OAuth client ID (project #1061433368940)
// This bypasses Vercel env var issues on the old deployment
const GOOGLE_CLIENT_ID = "1061433368940-efg0dtq7j5linpfbimcnlu14b8da92ht.apps.googleusercontent.com";
const GOOGLE_REDIRECT = window.location.origin;
const SCOPES = "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive.readonly";
const SLACK_CLIENT_ID = import.meta.env.VITE_SLACK_CLIENT_ID;
const SLACK_USER_SCOPES = "channels:read,channels:history,groups:read,groups:history,chat:write,users:read,im:read,im:write,im:history";
const MS_CLIENT_ID = import.meta.env.VITE_MS_CLIENT_ID;
const MS_SCOPES = "Mail.Read Calendars.ReadWrite User.Read Sites.Read.All Files.Read.All Chat.Read Team.ReadBasic.All Channel.ReadBasic.All ChannelMessage.Read.All";

// Implicit flow: returns access_token directly in URL hash (no client_secret needed)
export function googleAuthUrl(loginHint, forceConsent = false) {
  const params = {
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT,
    response_type: "token",
    scope: SCOPES,
    prompt: forceConsent ? "consent" : "select_account",
    state: "google",
  };
  if (loginHint) params.login_hint = loginHint;
  return "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams(params);
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
      prompt: "select_account",
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

  // Handle OAuth callbacks (MS and Slack use auth code flow via server)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");

    // Handle MS auth code
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
    }
    // Handle Slack auth code
    else if (code && (state === "slack" || !state)) {
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

  // Google OAuth implicit flow: token comes back in URL hash fragment
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("access_token")) {
      const hashParams = new URLSearchParams(hash.substring(1));
      const state = hashParams.get("state");
      // Only process if it's a Google auth callback (or no state for backward compat)
      if (state === "google" || !state || state === "") {
        const t = hashParams.get("access_token");
        const expiresIn = hashParams.get("expires_in");
        if (t) {
          localStorage.setItem("g_token", t);
          setToken(t);
          if (expiresIn) {
            const expiryTime = Date.now() + parseInt(expiresIn) * 1000;
            localStorage.setItem("g_token_expiry", expiryTime.toString());
          }
          window.history.replaceState(null, "", window.location.pathname);
        }
      }
    }
  }, []);

  // Auto-clear expired Google token (implicit flow has no refresh tokens)
  useEffect(() => {
    if (!token) return;

    const expiryStr = localStorage.getItem("g_token_expiry");
    if (!expiryStr) return;

    const expiry = parseInt(expiryStr);
    const now = Date.now();

    if (now >= expiry) {
      // Token already expired, clear it
      localStorage.removeItem("g_token");
      localStorage.removeItem("g_token_expiry");
      setToken("");
      return;
    }

    // Schedule token clear at expiry
    const timer = setTimeout(() => {
      localStorage.removeItem("g_token");
      localStorage.removeItem("g_token_expiry");
      setToken("");
    }, expiry - now);

    return () => clearTimeout(timer);
  }, [token]);

  const logout = () => {
    localStorage.removeItem("g_token");
    localStorage.removeItem("g_email");
    localStorage.removeItem("g_token_expiry");
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
