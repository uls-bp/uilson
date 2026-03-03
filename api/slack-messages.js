export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-slack-token");
  if (req.method === "OPTIONS") return res.status(200).end();

  const token = req.query.token || req.headers["x-slack-token"];
  if (!token) return res.status(400).json({ error: "No Slack token provided" });

  try {
    // Step 1: Get all public channels in workspace
    const chRes = await fetch(
      "https://slack.com/api/conversations.list?types=public_channel&limit=100&exclude_archived=true",
      { headers: { Authorization: "Bearer " + token } }
    ).then((r) => r.json());

    if (!chRes.ok) return res.status(400).json({ error: chRes.error });

    const channels = chRes.channels || [];
    const results = [];

    // Step 2: For each channel (up to 10), join then read history
    for (const ch of channels.slice(0, 10)) {
      // Auto-join the channel (silently fails if already joined or no permission)
      try {
        await fetch("https://slack.com/api/conversations.join", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ channel: ch.id }),
        });
      } catch (e) {
        // ignore join errors
      }

      // Read recent messages
      try {
        const msgRes = await fetch(
          "https://slack.com/api/conversations.history?channel=" +
            ch.id +
            "&limit=5",
          { headers: { Authorization: "Bearer " + token } }
        ).then((r) => r.json());

        if (msgRes.ok && msgRes.messages) {
          for (const m of msgRes.messages) {
            results.push({
              channel: ch.name,
              user: m.user || "bot",
              text: m.text,
              ts: m.ts,
            });
          }
        }
      } catch (e) {
        // skip channels we can't read
      }
    }

    // Step 3: Resolve user IDs to names
    const userIds = [...new Set(results.map((r) => r.user).filter((u) => u !== "bot"))];
    const userMap = {};
    for (const uid of userIds.slice(0, 20)) {
      try {
        const uRes = await fetch(
          "https://slack.com/api/users.info?user=" + uid,
          { headers: { Authorization: "Bearer " + token } }
        ).then((r) => r.json());
        if (uRes.ok) userMap[uid] = uRes.user.real_name || uRes.user.name;
      } catch (e) {
        // skip
      }
    }

    const messages = results.map((r) => ({
      ...r,
      userName: userMap[r.user] || r.user,
      date: new Date(parseFloat(r.ts) * 1000).toLocaleString("ja-JP"),
    }));

    return res.status(200).json({ connected: true, messages });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
