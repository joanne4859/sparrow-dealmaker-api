import crypto from "crypto";

export const config = {
  api: {
    bodyParser: false, // IMPORTANT: we need raw body for signature verification
  },
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const secret = process.env.DEALMAKER_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(500).json({ ok: false, error: "Missing DEALMAKER_WEBHOOK_SECRET" });
  }

  try {
    const rawBody = await getRawBody(req);

    // Dealmaker signature header (header keys are case-insensitive in Node)
    const headerSig =
      req.headers["x-dealmaker-signature"] ||
      req.headers["x-dealmaker-signature".toLowerCase()];

    if (!headerSig) {
      return res.status(401).json({ ok: false, error: "Missing X-Dealmaker-Signature" });
    }

    // Some providers prefix signatures like "sha1=..."; tolerate that.
    const received = String(headerSig).replace(/^sha1=/i, "").trim();

    const expected = crypto
      .createHmac("sha1", secret)
      .update(rawBody)
      .digest("hex");

    const a = Buffer.from(received, "hex");
    const b = Buffer.from(expected, "hex");

    // timing-safe compare (also guards length mismatch)
    const match = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!match) {
      return res.status(401).json({ ok: false, error: "Invalid signature" });
    }

    // Now it's safe to parse JSON
    const event = JSON.parse(rawBody);

    // Log minimal safe fields (avoid printing PII)
    console.log("✅ Verified webhook:", {
      event: event.event,
      event_id: event.event_id,
      deal_id: event.deal?.id,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(400).json({ ok: false, error: "Bad webhook payload" });
  }
}
