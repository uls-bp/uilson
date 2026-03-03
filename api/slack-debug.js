export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: "no token" });
  try {
    // Check scopes via auth.test
    const authRes = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: { Authorization: "Bearer " + token }
    });
    const scopeHeader = authRes.headers.get("x-oauth-scopes") || "none";
    const authData = await authRes.json();
    
    // Try conversations.list
    const listRes = await fetch(
      "https://slack.com/api/conversations.list?types=public_channel&limit=5&exclude_archived=true",
      { headers: { Authorization: "Bearer " + token } }
    ).then(r => r.json());
    
    const channels = (listRes.channels || []).map(c => ({ id: c.id, name: c.name, isMember: c.is_member }));
    
    // Try join first channel
    let joinResult = null;
    if (channels.length > 0) {
      const joinRes = await fetch("https://slack.com/api/conversations.join", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ channel: channels[0].id })
      }).then(r => r.json());
      joinResult = { ok: joinRes.ok, error: joinRes.error || null };
    }
    
    return res.json({ scopes: scopeHeader, authOk: authData.ok, channels, joinResult });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}