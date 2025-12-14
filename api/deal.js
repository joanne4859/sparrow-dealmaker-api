let cachedToken = null;
let cachedTokenExpiresAtMs = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiresAtMs - 10_000) return cachedToken;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.DEALMAKER_CLIENT_ID,
    client_secret: process.env.DEALMAKER_CLIENT_SECRET,
    scope: process.env.DEALMAKER_SCOPE
  });

  const r = await fetch(process.env.DEALMAKER_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Token request failed (${r.status}): ${JSON.stringify(data)}`);

  cachedToken = data.access_token;
  cachedTokenExpiresAtMs = now + (Number(data.expires_in || 0) * 1000);
  return cachedToken;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const id = req.query.id;
  if (!id) return res.status(400).json({ ok: false, error: "Missing ?id=DEAL_ID" });

  try {
    const token = await getAccessToken();
    const url = `https://api.dealmaker.tech/deals/${encodeURIComponent(id)}`;

    const r = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ ok: false, status: r.status, error: data });

    return res.status(200).json({ ok: true, data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
