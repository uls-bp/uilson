import { useState, useEffect, useRef } from "react";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const GOOGLE_REDIRECT = window.location.origin;
const SCOPES =
  "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive.readonly";
const SLACK_CLIENT_ID = import.meta.env.VITE_SLACK_CLIENT_ID;
const SLACK_USER_SCOPES =
  "channels:read,channels:history,grous:read,groups:history,chat:write,users:read,im:read,im:write,im:history";
const MS_CLIENT_ID = import.meta.env.VITE_MS_CLIENT_ID;
const MS_SCOPES = "Mail.Read Calendars.ReadWrite User.Read Sites.Read.All Files.Read.All Chat.Read Team.ReadBasic.All Channel.ReadBasic.All ChannelMessage.Read.All";

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
function msAuthUrl() {
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

async function fetchGmail(token) {
  const res = await fetch(
    (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - 2);
      return (
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q=after:" +
        d.getFullYear() +
        "/" +
        (d.getMonth() + 1) +
        "/" +
        d.getDate()
      );
    })(),
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
  const now = new Date();
  const oneMonthAgo = new Date(now);
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  const oneMonthLater = new Date(now);
  oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);

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

  const allEvents = await Promise.all(
    calendarIds.map(async (calId) => {
      try {
        const res = await fetch(
          "https://www.googleapis.com/calendar/v3/calendars/" +
            encodeURIComponent(calId) +
            "/events?maxResults=250&timeMin=" +
            oneMonthAgo.toISOString() +
            "&timeMax=" +
            oneMonthLater.toISOString() +
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

async function fetchOutlookMail(msToken) {
  const now = new Date();
  const oneMonthAgo = new Date(now);
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  const filterDate = oneMonthAgo.toISOString();
  const url =
    "https://graph.microsoft.com/v1.0/me/messages?$top=50&$filter=receivedDateTime ge " +
    filterDate +
    "&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,bodyPreview";
  const res = await fetch(url, {
    headers: { Authorization: "Bearer " + msToken },
  });
  if (res.status === 401) throw new Error("MS_AUTH_EXPIRED");
  const data = await res.json();
  return (data.value || []).map((m) => ({
    id: m.id,
    subject: m.subject || "",
    from:
      (m.from?.emailAddress?.name || "") +
      " <" +
      (m.from?.emailAddress?.address || "") +
      ">",
    date: m.receivedDateTime || "",
    snippet: m.bodyPreview || "",
  }));
}

async function fetchOutlookCalendar(msToken) {
  const now = new Date();
  const oneMonthAgo = new Date(now);
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  const oneMonthLater = new Date(now);
  oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);
  const url =
    "https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=" +
    oneMonthAgo.toISOString() +
    "&endDateTime=" +
    oneMonthLater.toISOString() +
    "&$top=200&$orderby=start/dateTime&$select=id,subject,start,end,location";
  const res = await fetch(url, {
    headers: { Authorization: "Bearer " + msToken },
  });
  if (res.status === 401) throw new Error("MS_AUTH_EXPIRED");
  const data = await res.json();
  return (data.value || []).map((e) => ({
    id: e.id,
    summary: e.subject || "",
    start: e.start?.dateTime || "",
    end: e.end?.dateTime || "",
    location: e.location?.displayName || "",
  }));
}

async function fetchSharePointSites(tk){try{const r=await fetch("https://graph.microsoft.com/v1.0/sites?search=*&$top=20&$select=id,displayName,webUrl,description",{headers:{Authorization:"Bearer "+tk}});if(!r.ok)return[];const d=await r.json();return(d.value||[]).map(s=>({id:s.id,name:s.displayName,url:s.webUrl,desc:s.description}))}catch{return[]}}
async function fetchSharePointFiles(tk,siteId){try{const r=await fetch("https://graph.microsoft.com/v1.0/sites/"+siteId+"/drive/root/children?$top=50&$select=id,name,webUrl,size,lastModifiedDateTime,file,folder",{headers:{Authorization:"Bearer "+tk}});if(!r.ok)return[];const d=await r.json();return(d.value||[]).map(f=>({id:f.id,name:f.name,url:f.webUrl,size:f.size,modified:f.lastModifiedDateTime,isFolder:!!f.folder}))}catch{return[]}}
async function fetchAllSharePointData(tk){const sites=await fetchSharePointSites(tk);let allFiles=[];for(const site of sites.slice(0,5)){const files=await fetchSharePointFiles(tk,site.id);allFiles=allFiles.concat(files.map(f=>({...f,siteName:site.name})))}return{sites,files:allFiles}}
async function fetchTeamsChats(tk){try{const r=await fetch('https://graph.microsoft.com/v1.0/me/chats?$top=20&$expand=lastMessagePreview&$orderby=lastMessagePreview/createdDateTime desc',{headers:{Authorization:'Bearer '+tk}});if(!r.ok)return[];const d=await r.json();return(d.value||[]).map(ch=>({id:ch.id,topic:ch.topic||'(no topic)',type:ch.chatType,lastMsg:ch.lastMessagePreview?{from:ch.lastMessagePreview.from?.user?.displayName||'',body:(ch.lastMessagePreview.body?.content||'').replace(/<[^>]*>/g,'').substring(0,200),date:ch.lastMessagePreview.createdDateTime}:null}))}catch(e){console.error('Teams chats err',e);return[]}}
async function fetchTeamsChannelMessages(tk){try{const tr=await fetch('https://graph.microsoft.com/v1.0/me/joinedTeams?$top=10',{headers:{Authorization:'Bearer '+tk}});if(!tr.ok)return[];const td=await tr.json();const teams=td.value||[];const results=[];for(const team of teams.slice(0,5)){const cr=await fetch('https://graph.microsoft.com/v1.0/teams/'+team.id+'/channels?$top=5',{headers:{Authorization:'Bearer '+tk}});if(!cr.ok)continue;const cd=await cr.json();for(const ch of(cd.value||[]).slice(0,3)){try{const mr=await fetch('https://graph.microsoft.com/v1.0/teams/'+team.id+'/channels/'+ch.id+'/messages?$top=5',{headers:{Authorization:'Bearer '+tk}});if(!mr.ok)continue;const md=await mr.json();(md.value||[]).forEach(m=>{results.push({team:team.displayName,channel:ch.displayName,from:m.from?.user?.displayName||'',body:(m.body?.content||'').replace(/<[^>]*>/g,'').substring(0,200),date:m.createdDateTime})})}catch(e){}}}return results}catch(e){console.error('Teams channels err',e);return[]}}
async function fetchGoogleDriveFiles(token){try{const r=await fetch('https://www.googleapis.com/drive/v3/files?pageSize=50&orderBy=modifiedTime desc&fields=files(id,name,mimeType,modifiedTime,owners,webViewLink)&q=trashed=false',{headers:{Authorization:'Bearer '+token}});if(!r.ok)return[];const d=await r.json();return(d.files||[]).map(f=>({id:f.id,name:f.name,type:f.mimeType,modified:f.modifiedTime,owner:(f.owners&&f.owners[0])?f.owners[0].displayName:'',link:f.webViewLink||''}))}catch(e){console.error('Drive err',e);return[]}}

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

function buildContext(emails, events, slackMsgs, outlookEmails, outlookEvents, spSites, spFiles, teamsChats, teamsChannels, driveFiles) {
  const dayNames = ["æ¥", "æ", "ç«", "æ°´", "æ¨", "é", "å"];
  let ctx = "";
  if (emails.length) {
    ctx += "\n## Gmail (latest " + emails.length + ")\n";
    emails.forEach((e) => {
      const d = e.date ? new Date(e.date) : null;
      const dow = d && !isNaN(d) ? "(" + dayNames[d.getDay()] + ")" : "";
      ctx +=
        "- [ID:" +
        e.id +
        "] From:" +
        e.from +
        " Sub:" +
        e.subject +
        " Date:" +
        e.date +
        dow +
        " Snippet:" +
        e.snippet +
        "\n";
    });
  }
  if (events.length) {
    ctx += "\n## Google Calendar (upcoming " + events.length + ")\n";
    events.forEach((e) => {
      const ds = e.start ? new Date(e.start) : null;
      const de = e.end ? new Date(e.end) : null;
      const dowStart = ds ? "(" + dayNames[ds.getDay()] + ")" : "";
      const dowEnd = de ? "(" + dayNames[de.getDay()] + ")" : "";
      ctx +=
        "- [ID:" +
        e.id +
        "] " +
        e.summary +
        " " +
        e.start +
        dowStart +
        " ~ " +
        e.end +
        dowEnd +
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
  if (outlookEmails && outlookEmails.length) {
    ctx += "\n## Outlook Mail (latest " + outlookEmails.length + ")\n";
    outlookEmails.forEach((e) => {
      const d = e.date ? new Date(e.date) : null;
      const dow = d && !isNaN(d) ? "(" + dayNames[d.getDay()] + ")" : "";
      ctx +=
        "- [ID:" +
        e.id +
        "] From:" +
        e.from +
        " Sub:" +
        e.subject +
        " Date:" +
        e.date +
        dow +
        " Snippet:" +
        e.snippet +
        "\n";
    });
  }
  if (outlookEvents && outlookEvents.length) {
    ctx += "\n## Outlook Calendar (upcoming " + outlookEvents.length + ")\n";
    outlookEvents.forEach((e) => {
      const ds = e.start ? new Date(e.start) : null;
      const de = e.end ? new Date(e.end) : null;
      const dowStart =
        ds && !isNaN(ds) ? "(" + dayNames[ds.getDay()] + ")" : "";
      const dowEnd = de && !isNaN(de) ? "(" + dayNames[de.getDay()] + ")" : "";
      ctx +=
        "- [ID:" +
        e.id +
        "] " +
        e.summary +
        " " +
        e.start +
        dowStart +
        " ~ " +
        e.end +
        dowEnd +
        (e.location ? " @" + e.location : "") +
        "\n";
    });
  }
      if(spSites.length>0){ctx+="\n\n[SharePoint Sites]\n";ctx+=spSites.map(s=>s.name+" - "+s.url+(s.desc?" ("+s.desc+")":"")).join("\n")}
    if(spFiles.length>0){ctx+="\n\n[SharePoint Files]\n";ctx+=spFiles.map(f=>f.name+" ("+f.siteName+") - "+f.url+(f.isFolder?" [folder]":" "+Math.round((f.size||0)/1024)+"KB")).join("\n")}
    
if(teamsChats&&teamsChats.length>0){ctx+="\n\n## Teams Chats (Recent):\n";teamsChats.forEach(ch=>{ctx+="- "+ch.topic+" ("+ch.type+")";if(ch.lastMsg){ctx+=" | Last: "+ch.lastMsg.from+": "+ch.lastMsg.body+" ("+ch.lastMsg.date+")";}ctx+="\n";})}
if(teamsChannels&&teamsChannels.length>0){ctx+="\n\n## Teams Channel Messages (Recent):\n";teamsChannels.forEach(m=>{ctx+="- ["+m.team+" > "+m.channel+"] "+m.from+": "+m.body+" ("+m.date+")\n";})}
if(driveFiles&&driveFiles.length>0){ctx+="\n\n## Google Drive Files (Recent):\n";driveFiles.forEach(f=>{const d=new Date(f.modified);const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];ctx+="- "+f.name+" ("+f.type+") | Modified: "+days[d.getDay()]+" "+d.toLocaleDateString()+" | Owner: "+f.owner+"\n";})}
return ctx;
}

/* --- V16 Design System --- */
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
  const [token, setToken] = useState(
    localStorage.getItem("g_token") || ""
  );
  const [emails, setEmails] = useState([]);
  const [events, setEvents] = useState([]);
  const [googleEmail, setGoogleEmail] = useState(
    localStorage.getItem("g_email") || ""
  );
  const [slackConnected, setSlackConnected] = useState(false);
  const [slackToken, setSlackToken] = useState(
    localStorage.getItem("slack_token")
  );
  const [slackMsgs, setSlackMsgs] = useState([]);
  const [slackEmail, setSlackEmail] = useState(
    localStorage.getItem("slack_email") || ""
  );

  // Outlook state
  const [msToken, setMsToken] = useState(
    localStorage.getItem("ms_token") || ""
  );
  const [msEmail, setMsEmail] = useState(
    localStorage.getItem("ms_email") || ""
  );
  const [outlookEmails, setOutlookEmails] = useState([]);
  const [outlookEvents, setOutlookEvents] = useState([]);
  const [spSites, setSpSites] = useState([]);
  const [spFiles, setSpFiles] = useState([]);
const [teamsChats, setTeamsChats] = useState([]);
const [teamsChannels, setTeamsChannels] = useState([]);
const [driveFiles, setDriveFiles] = useState([]);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState("chat");
  const [sbCollapsed, setSbCollapsed] = useState(false);
  const bottomRef = useRef(null);

  // Google OAuth (hash fragment)
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

  // Google data fetch
  useEffect(() => {
    if (token) {
      fetchGmail(token)
        .then(setEmails)
        .catch((e) => {
          console.error(e);
          if (e.message === "AUTH_EXPIRED") {
            localStorage.removeItem("g_token");
            setToken(null);
          }
        });
      fetchCalendar(token)
        .then(setEvents)
        .catch((e) => {
          console.error(e);
          if (e.message === "AUTH_EXPIRED") {
            localStorage.removeItem("g_token");
            setToken(null);
          }
        });
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
      fetchGoogleDriveFiles(token).then(setDriveFiles).catch(console.error);
    }
  }, [token]);

  // Slack OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (code && state === "ms") {
      // Microsoft OAuth callback
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
      // Slack OAuth callback
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

  // Slack data fetch
  useEffect(() => {
    if (slackToken) {
      fetchSlack(slackToken)
        .then((r) => {
          setSlackConnected(r.connected);
          setSlackMsgs(r.messages);
        })
        .catch(console.error);
    }
    if (slackToken) {
      fetch(
        "/api/slack-userinfo?token=" + encodeURIComponent(slackToken)
      )
        .then((r) => r.json())
        .then((d) => {
          if (d.ok) {
            const info =
              d.email ||
              (d.user ? d.user + " @ " + (d.team || "Slack") : null);
            if (info) {
              setSlackEmail(info);
              localStorage.setItem("slack_email", info);
            }
          }
        })
        .catch(console.error);
    }
  }, [slackToken]);

  // Outlook data fetch
  useEffect(() => {
    if (msToken) {
      fetchOutlookMail(msToken)
        .then(setOutlookEmails)
        .catch((e) => {
          console.error(e);
          if (e.message === "MS_AUTH_EXPIRED") {
            localStorage.removeItem("ms_token");
            setMsToken("");
          }
        });
      fetchOutlookCalendar(msToken)
        .then(setOutlookEvents)
        .catch((e) => {
          console.error(e);
          if (e.message === "MS_AUTH_EXPIRED") {
            localStorage.removeItem("ms_token");
            setMsToken("");
          }
        });
      // Fetch Outlook user email
      fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: "Bearer " + msToken },
      })
        .then((r) => r.json())
        .then((d) => {
          const email =
            d.mail || d.userPrincipalName || "";
          if (email) {
            setMsEmail(email);
            localStorage.setItem("ms_email", email);
          }
        })
        .catch(console.error);
    }
  }, [msToken]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const getContext = async () => {
    let e = emails,
      ev = events,
      sm = slackMsgs,
      oe = outlookEmails,
      oev = outlookEvents;
    if (token) {
      try {
        e = await fetchGmail(token);
        setEmails(e);
        ev = await fetchCalendar(token);
        setEvents(ev);const df=await fetchGoogleDriveFiles(t);setDriveFiles(df);
      } catch {}
    }
    try {
      const r = await fetchSlack(slackToken);
      sm = r.messages;
      setSlackMsgs(sm);
      setSlackConnected(r.connected);
    } catch {}
    if (msToken) {
      try {
        oe = await fetchOutlookMail(msToken);
        setOutlookEmails(oe);
        oev = await fetchOutlookCalendar(msToken);
        setOutlookEvents(oev);
          const spD=await fetchAllSharePointData(tk);setSpSites(spD.sites);setSpFiles(spD.files);const tChats=await fetchTeamsChats(tk);setTeamsChats(tChats);const tCh=await fetchTeamsChannelMessages(tk);setTeamsChannels(tCh);
      } catch {}
    }
    return buildContext(e, ev, sm, oe, oev, spSites, spFiles, teamsChats, teamsChannels, driveFiles);
  };

  const send = async (text) => {
    if (!text.trim()) return;
    const userMsg = { role: "user", content: text };
    setMessages((p) => [...p, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const ctx = await getContext();
      const dowNames = ["æ¥", "æ", "ç«", "æ°´", "æ¨", "é", "å"];
      const currentDate = new Date();
      const systemPrompt =
        "You are UILSON, a professional AI business assistant. Current: " +
        currentDate.toLocaleString("ja-JP") +
        " (" +
        dowNames[currentDate.getDay()] +
        "ææ¥)" +
        "\nUser data:" +
        ctx +
        "\nReply in user language. For greetings, give a brief daily briefing using Gmail, Calendar, Slack, and Outlook data." +
        "\nIMPORTANT: Calendar events already include correct day-of-week labels like (æ)(ç«). Always use these labels as-is. Never guess or recalculate day-of-week yourself." +
        "\nFor Outlook calendar operations, use outlook_calendar_create/update/delete tools." +
        "\nIMPORTANT: When user asks about specific emails or calendar events not shown in the context above, ALWAYS use search tools (outlook_search_mail, outlook_list_events, gmail_search) to dynamically fetch data from the server. NEVER say data is unavailable without trying the search tools first." + "\nFor Slack operations: use slack_search_users to find people by name/email, slack_read_dm to read DM history, slack_send_dm to send messages. ALWAYS use slack_search_users when asked to find or search for someone on Slack." + "\nFor Google Drive: use google_drive_search/google_drive_list/google_drive_get_content tools.";
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg]
            .slice(-20)
            .map((m) => ({ role: m.role, content: m.content })),
          system: systemPrompt,
          googleToken: token,
          msToken: msToken,
            slackToken: slackToken,
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
      label: "âï¸ ä»æ¥ã®ããªã¼ãã£ã³ã°",
      text: "ãã¯ããï¼ä»æ¥ã®ããªã¼ãã£ã³ã°ããã ããã",
    },
    {
      label: "âï¸ æªèª­ã¡ã¼ã«",
      text: "æªèª­ã¡ã¼ã«ãè¦ç´ãã¦ãã ããã",
    },
    {
      label: "ð ä»æ¥ã®äºå®",
      text: "ä»æ¥ã®ã«ã¬ã³ãã¼ã®äºå®ã¯ï¼",
    },
    {
      label: "ð¬ Slackã¡ãã»ã¼ã¸",
      text: "æè¿ã®Slackã¡ãã»ã¼ã¸ãè¦ãã¦ã",
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

  const slackLogout = () => {
    localStorage.removeItem("slack_token");
    localStorage.removeItem("slack_email");
    setSlackToken(null);
    setSlackConnected(false);
    setSlackMsgs([]);
    setSlackEmail("");
  };

  const msLogout = () => {
    localStorage.removeItem("ms_token");
    localStorage.removeItem("ms_email");
    setMsToken("");
    setMsEmail("");
    setOutlookEmails([]);
    setOutlookEvents([]);
  };

  const navItems = [
    { id: "chat", icon: "ð¬", label: "æç¤ºåºã" },
    { id: "settings", icon: "âï¸", label: "è¨­å®" },
  ];

  return (
    <>
      <style>{globalCSS}</style>
      <div
        style={{
          display: "flex",
          height: "100vh",
          background: V.bg,
          color: V.t1,
        }}
      >
        {/* --- Sidebar --- */}
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
                  AIæ¥­åã¢ã·ã¹ã¿ã³ã
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
                â
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
                â¶
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
                    view === n.id ? "rgba(60,89,150,0.08)" : "transparent",
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
                <span
                  style={{
                    fontSize: 19,
                    flexShrink: 0,
                    width: 22,
                    textAlign: "center",
                  }}
                >
                  {n.icon}
                </span>
                {!sbCollapsed && <span>{n.label}</span>}
              </div>
            ))}
            <div
              style={{
                height: 1,
                background: V.border,
                margin: "10px 14px",
              }}
            />
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
                  {"æ¥ç¶ä¸­ã®ã·ã¹ãã "}
                </div>
                {[
                  { name: "Google", on: !!token },
                  { name: "Slack", on: slackConnected },
                  { name: "Outlook", on: !!msToken },
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
                <div style={{ fontSize: 13, fontWeight: 600, color: V.t1 }}>
                  Masataka
                </div>
                <div style={{ fontSize: 11, color: V.t4 }}>v2.0</div>
              </div>
            )}
          </div>
        </div>

        {/* --- Main --- */}
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
            /* --- Settings View --- */
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                height: "100%",
              }}
            >
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
                    {"âï¸ è¨­å®"}
                  </div>
                  <div style={{ fontSize: 14, color: V.t3, marginTop: 2 }}>
                    {"å¤é¨ãµã¼ãã¹ã®æ¥ç¶ç®¡ç"}
                  </div>
                </div>
              </div>
              <div
                style={{
                  flex: 1,
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
                    <span>{"ð"}</span> Googleã¢ã«ã¦ã³ã
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
                          <span
                            style={{
                              color: V.green,
                              fontWeight: 600,
                              fontSize: 14,
                            }}
                          >
                            {"æ¥ç¶æ¸ã¿"}
                          </span>
                          {googleEmail && (
                            <span
                              style={{
                                fontSize: 13,
                                color: V.t3,
                                marginLeft: 8,
                              }}
                            >
                              ({googleEmail})
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: 13,
                            color: V.t3,
                            marginBottom: 12,
                          }}
                        >
                          Gmail: {emails.length}ä»¶ / Calendar:{" "}
                          {events.length}ä»¶
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
                          {"åæ­"}
                        </button>
                      </>
                    ) : (
                      <>
                        <div
                          style={{
                            fontSize: 14,
                            color: V.t3,
                            marginBottom: 12,
                          }}
                        >
                          {"æªæ¥ç¶ â Gmailã¨ã«ã¬ã³ãã¼ãé£æºãã¾ã"}
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
                          Googleãæ¥ç¶
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
                    <span>{"ð¬"}</span> Slack
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
                          <span
                            style={{
                              color: V.green,
                              fontWeight: 600,
                              fontSize: 14,
                            }}
                          >
                            {"æ¥ç¶æ¸ã¿"}
                          </span>
                          {slackEmail && (
                            <span
                              style={{
                                fontSize: 13,
                                color: V.t3,
                                marginLeft: 8,
                              }}
                            >
                              ({slackEmail})
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 13, color: V.t3 }}>
                          {slackMsgs.length}
                          ä»¶ã®ã¡ãã»ã¼ã¸ãåå¾
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
                          {"åæ­"}
                        </button>
                      </>
                    ) : (
                      <>
                        <div
                          style={{
                            fontSize: 14,
                            color: V.t3,
                            marginBottom: 8,
                          }}
                        >
                          {"æªæ¥ç¶"}
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
                          {"Slackãæ¥ç¶"}
                        </a>
                      </>
                    )}
                  </div>
                </div>

                {/* Outlook Card */}
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
                    <span>{"ð§"}</span> Outlook (Microsoft 365)
                  </div>
                  <div style={{ padding: 16 }}>
                    {msToken ? (
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
                          <span
                            style={{
                              color: V.green,
                              fontWeight: 600,
                              fontSize: 14,
                            }}
                          >
                            {"æ¥ç¶æ¸ã¿"}
                          </span>
                          {msEmail && (
                            <span
                              style={{
                                fontSize: 13,
                                color: V.t3,
                                marginLeft: 8,
                              }}
                            >
                              ({msEmail})
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: 13,
                            color: V.t3,
                            marginBottom: 12,
                          }}
                        >
                          Mail: {outlookEmails.length}ä»¶ / Calendar:{" "}
                          {outlookEvents.length}ä»¶
                        </div>
                        <button
                          onClick={msLogout}
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
                          {"åæ­"}
                        </button>
                      </>
                    ) : (
                      <>
                        <div
                          style={{
                            fontSize: 14,
                            color: V.t3,
                            marginBottom: 12,
                          }}
                        >
                          {"æªæ¥ç¶ â Outlookã¡ã¼ã«ã¨ã«ã¬ã³ãã¼ãé£æºãã¾ã"}
                        </div>
                        <a
                          href={msAuthUrl()}
                          style={{
                            display: "inline-block",
                            padding: "8px 18px",
                            borderRadius: 7,
                            border: "none",
                            background:
                              "linear-gradient(135deg, #0078D4, #106EBE)",
                            color: V.white,
                            fontSize: 15,
                            fontWeight: 600,
                            cursor: "pointer",
                            fontFamily: "inherit",
                            textDecoration: "none",
                          }}
                        >
                          Outlookãæ¥ç¶
                        </a>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* --- Chat View --- */
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                height: "100%",
              }}
            >
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
                    {"ð¬ æç¤ºåºã"}
                  </div>
                  <div style={{ fontSize: 14, color: V.t3, marginTop: 2 }}>
                    {"AIãã¡ã¼ã«ã»ã«ã¬ã³ãã¼ã»Slackã»Outlookãæ¨ªæ­ãã¦å¤æ­ãã¾ã"}
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
                  {[
                    { name: "Gmail", on: !!token },
                    { name: "Calendar", on: !!token },
                    { name: "Slack", on: slackConnected },
                    { name: "Outlook Mail", on: !!msToken },
                    { name: "Outlook Cal", on: !!msToken },
              { name: "SharePoint", on: spSites.length > 0 },{name:"Teams",on:teamsChats.length>0||teamsChannels.length>0},{name:"Google Drive",on:driveFiles.length>0},
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
                    <div
                      style={{
                        width: 64,
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
                        {"AIæ¥­åã¢ã·ã¹ã¿ã³ã â ä½ã§ãè´ãã¦ãã ãã"}
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
                            e.currentTarget.style.transform =
                              "translateY(-1px)";
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
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                      }}
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
                  <div
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
                        color: V.t3,
                      }}
                    >
                      <span
                        style={{
                          animation: "pulse 1.2s ease-in-out infinite",
                        }}
                      >
                        {"ð æå ±ãåéã»åæä¸­..."}
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
                    placeholder={
                      "ä¾ï¼ãä»æ¥ã®äºå®æãã¦ããæªèª­ã¡ã¼ã«ãè¦ç´ãã¦ã"
                    }
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
                    {"éä¿¡ â"}
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

Claude is active in this tab group
Open chat
Dismiss
