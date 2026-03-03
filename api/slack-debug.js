export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: "no token" });
  try {
    const listRes = await fetch(
      "https://slack.com/api/conversations.list?types=public_channel&limit=10&exclude_archived=true",
      { headers: { Authorization: "Bearer " + token } }
    ).then(r => r.json());
    
    const channels = (listRes.channels || []).map(c => ({ id: c.id, name: c.name, isMember: c.is_member }));
    
    let joinResult = null;
    if (channels.length > 0) {
      const joinRes = await fetch("https://slack.com/api/conversations.join", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ channel: channels[0].id })
      }).then(r => r.json());
      joinResult = { ok: joinRes.ok, error: joinRes.error || null };
    }
    
    return res.json({ listOk: listRes.ok, listError: listRes.error || null, channelCount: channels.length, channels, joinResult });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}