import { useState, useEffect, useCallback } from "react";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const GOOGLE_REDIRECT = window.location.origin;
const SCOPES = "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive.readonly";
const SLACK_CLIENT_ID = import.meta.env.VITE_SLACK_CLIENT_ID;
const SLACK_USER_SCOPES = "channels:read,channels:history,groups:read,groups:history,chat:write,users:read,im:read,im:write,im:history";
const MS_CLIENT_ID = import.meta.env.VITE_MS_CLIENT_ID;
const MS_SCOPES = "Mail.Read Calendars.ReadWrite User.Read Sites.Read.All Files.Read.All Chat.Read Team.ReadBasic.All Channel.ReadBasic.All ChannelMessage.Read.All";

// Authorization Code flow (gets refresh token for persistent sessions)
export function googleAuthUrl(loginHint, forceConsent = false) {
  const params = {
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: forceConsent ? "consent" : "consent",
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

  // Refresh Google token using refresh_token
  const refreshGoogleToken = useCallback(async () => {
    const refreshToken = localStorage.getItem("g_refresh_token");
    if (!refreshToken) return false;

    try {
      const resp = await fetch(
        "/api/google-refresh?refresh_token=" + encodeURIComponent(refreshToken)
      ).then((r) => r.json());

      if (resp.ok && resp.access_token) {
        localStorage.setItem("g_token", resp.access_token);
        setToken(resp.access_token);
        if (resp.expires_in) {
          const expiryTime = Date.now() + parseInt(resp.expires_in) * 1000;
          localStorage.setItem("g_token_expiry", expiryTime.toString());
        }
        return true;
      }
    } catch (e) {
      console.error("Google token refresh failed:", e);
    }
    return false;
  }, []);

  // Google OAuth callback handler (Authorization Code flow)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");

    // Handle Google auth code
    if (code && state === "google") {
      fetch(
        "/api/google-oauth?code=" +
          encodeURIComponent(code) +
          "&redirect_uri=" +
          encodeURIComponent(window.location.origin)
      )
        .then((r) => r.json())
        .then((data) => {
          if (data.ok && data.access_token) {
            localStorage.setItem("g_token", data.access_token);
            setToken(data.access_token);
            if (data.refresh_token) {
              localStorage.setItem("g_refresh_token", data.refresh_token);
            }
            if (data.expires_in) {
              const expiryTime = Date.now() + parseInt(data.expires_in) * 1000;
              localStorage.setItem("g_token_expiry", expiryTime.toString());
            }
            window.history.replaceState({}, "", window.location.pathname);
          }
        })
        .catch(console.error);
    }
    // Handle MS auth code
    else if (code && state === "ms") {
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
    // Handle Slack auth code (no state or unrecognized state)
    else if (code && !state) {
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

  // Legacy: handle old implicit flow hash fragments (for backward compat)
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("access_token")) {
      const hashParams = new URLSearchParams(hash.substring(1));
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
  }, []);

  // Auto-refresh token before expiry using refresh_token
  useEffect(() => {
    if (!token) return;

    const expiryStr = localStorage.getItem("g_token_expiry");
    if (!expiryStr) return;

    const expiry = parseInt(expiryStr);
    const now = Date.now();
    const refreshTime = expiry - 5 * 60 * 1000; // 5 minutes before expiry

    if (now >= expiry) {
      // Token already expired, refresh now
      refreshGoogleToken();
      return;
    }

    if (now >= refreshTime) {
      // Close to expiry, refresh now
      refreshGoogleToken();
      return;
    }

    // Schedule refresh
    const timer = setTimeout(() => {
      refreshGoogleToken();
    }, refreshTime - now);

    return () => clearTimeout(timer);
  }, [token, refreshGoogleToken]);

  const logout = () => {
    localStorage.removeItem("g_token");
    localStorage.removeItem("g_email");
    localStorage.removeItem("g_token_expiry");
    localStorage.removeItem("g_refresh_token");
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
