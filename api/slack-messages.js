export default async function handler(req, res) {
    const token = req.query.token || req.headers["x-slack-token"];
    if (!token) return res.status(400).json({ error: "No Slack token provided" });

  try {
        const chRes = await fetch(
                "https://slack.com/api/users.conversations?types=public_channel,private_channel&limit=50&exclude_archived=true",
          { headers: { Authorization: "Bearer " + token } }
              ).then((r) => r.json());

      if (!chRes.ok) return res.status(400).json({ error: chRes.error });

      const channels = chRes.channels || [];
        const results = [];

      for (const ch of channels.slice(0, 8)) {
              const msgRes = await fetch(
                        "https://slack.com/api/conversations.history?channel=" + ch.id + "&limit=5",
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
      }

      const userIds = [...new Set(results.map((r) => r.user).filter((u) => u !== "bot"))];
        const userMap = {};
        for (const uid of userIds.slice(0, 20)) {
                const uRes = await fetch("https://slack.com/api/users.info?user=" + uid, {
                          headers: { Authorization: "Bearer " + token },
                }).then((r) => r.json());
                if (uRes.ok) userMap[uid] = uRes.user.real_name || uRes.user.name;
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