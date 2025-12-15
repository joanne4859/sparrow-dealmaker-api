// api/_dealmakerAuth.js
export async function getAccessToken() {
  const TOKEN_URL = process.env.DEALMAKER_TOKEN_URL;
  const CLIENT_ID = process.env.DEALMAKER_CLIENT_ID;
  const CLIENT_SECRET = process.env.DEALMAKER_CLIENT_SECRET;
  const SCOPE = process.env.DEALMAKER_SCOPE;

  if (!TOKEN_URL || !CLIENT_ID || !CLIENT_SECRET || !SCOPE) {
    throw new Error("Missing required environment variables for Dealmaker auth");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: SCOPE,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await response.json().catch(async () => {
    const text = await response.text();
    throw new Error(`Token response was not JSON: ${text}`);
  });

  if (!response.ok) {
    throw new Error(`Token request failed (${response.status}): ${JSON.stringify(data)}`);
  }

  if (!data.access_token) {
    throw new Error("Token response missing access_token");
  }

  return data.access_token;
}
