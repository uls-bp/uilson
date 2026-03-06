export default async function handler(req, res) {
  const { refresh_token } = req.query;
  if (!refresh_token) return res.status(400).json({ error: "refresh_token required" });

  const clientId = process.env.VITE_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  try {
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token,
      grant_type: "refresh_token",
    });

    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    }).then((r) => r.json());

    if (resp.error)
      return res
        .status(400)
        .json({ error: resp.error_description || resp.error });

    return res.status(200).json({
      ok: true,
      access_token: resp.access_token,
      expires_in: resp.expires_in,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
