export default async function handler(req, res) {
    const { code, redirect_uri } = req.query;
    if (!code) return res.status(400).json({ error: "code required" });

  const clientId = process.env.VITE_SLACK_CLIENT_ID;
    const clientSecret = process.env.SLACK_CLIENT_SECRET;

  try {
        const params = new URLSearchParams({
                code,
                client_id: clientId,
                client_secret: clientSecret,
        });
        if (redirect_uri) params.append("redirect_uri", redirect_uri);

      const resp = await fetch("https://slack.com/api/oauth.v2.access", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: params.toString(),
      }).then((r) => r.json());

      if (!resp.ok) return res.status(400).json({ error: resp.error });

      return res.status(200).json({
              ok: true,
              access_token: resp.access_token,
              team: resp.team,
              scope: resp.scope,
      });
  } catch (e) {
        return res.status(500).json({ error: e.message });
  }
}