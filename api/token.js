export default async function handler(req, res) {
  // CORS (ok for now; we’ll tighten later)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const TOKEN_URL = process.env.DEALMAKER_TOKEN_URL;
    const CLIENT_ID = process.env.DEALMAKER_CLIENT_ID;
    const CLIENT_SECRET = process.env.DEALMAKER_CLIENT_SECRET;
    const SCOPE = process.env.DEALMAKER_SCOPE;

    if (!TOKEN_URL || !CLIENT_ID || !CLIENT_SECRET || !SCOPE) {
      return res.status(500).json({
        ok: false,
        error: "Missing required environment variables"
      });
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: SCOPE
    });

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        status: response.status,
        error: data
      });
    }

    // IMPORTANT: do NOT return the actual access_token publicly
    return res.status(200).json({
      ok: true,
      token_type: data.token_type,
      expires_in: data.expires_in,
      scope: data.scope,
      created_at: data.created_at
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err)
    });
  }
}
