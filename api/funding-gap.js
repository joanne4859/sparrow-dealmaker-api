let cachedToken = null;
let cachedTokenExpiresAtMs = 0;

async function getAccessToken() {
  const now = Date.now();
  // reuse token until ~10 seconds before expiry
  if (cachedToken && now < cachedTokenExpiresAtMs - 10_000) return cachedToken;

  const TOKEN_URL = process.env.DEALMAKER_TOKEN_URL;
  const CLIENT_ID = process.env.DEALMAKER_CLIENT_ID;
  const CLIENT_SECRET = process.env.DEALMAKER_CLIENT_SECRET;
  const SCOPE = process.env.DEALMAKER_SCOPE;

  if (!TOKEN_URL || !CLIENT_ID || !CLIENT_SECRET || !SCOPE) {
    throw new Error("Missing Dealmaker env vars (TOKEN_URL/CLIENT_ID/CLIENT_SECRET/SCOPE).");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: SCOPE
  });

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`Token request failed (${r.status}): ${JSON.stringify(data)}`);
  }

  cachedToken = data.access_token;
  cachedTokenExpiresAtMs = now + (Number(data.expires_in || 0) * 1000);
  return cachedToken;
}

export default async function handler(req, res) {
  // CORS (ok for now; tighten later)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const id = req.query.id;
  if (!id) return res.status(400).json({ ok: false, error: "Missing ?id=DEAL_ID (example: ?id=4127)" });

  try {
    const token = await getAccessToken();

    // Dealmaker API base for deal endpoints is typically api.dealmaker.tech
    const url = `https://api.dealmaker.tech/deals/${encodeURIComponent(id)}/funding_gap_status`;

    const r = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      return res.status(r.status).json({
        ok: false,
        status: r.status,
        error: data
      });
    }

    return res.status(200).json({ ok: true, deal_id: id, data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}