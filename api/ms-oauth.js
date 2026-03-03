export default async function handler(req, res) {
  const { code, redirect_uri } = req.query;
  if (!code) return res.status(400).json({ error: "code required" });

  const clientId = process.env.VITE_MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;

  try {
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirect_uri || "https://uilson.vercel.app",
      grant_type: "authorization_code",
      scope: "Mail.Read Calendars.ReadWrite User.Read",
    });

    const resp = await fetch(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      }
    ).then((r) => r.json());

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
