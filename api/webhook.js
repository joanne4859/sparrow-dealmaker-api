import crypto from "crypto";

export const config = {
  api: {
    bodyParser: false,
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

function sha256(value) {
  if (!value) return undefined;
  return crypto.createHash("sha256").update(String(value).trim().toLowerCase()).digest("hex");
}

function normalizePhone(phone) {
  if (!phone) return undefined;
  return String(phone).replace(/\D/g, "");
}

const EVENT_MAP = {
  "investor.create":   "InitiateCheckout",
  "investor.signed":   "Lead",
  "investor.funded":   "Purchase",
  "investor.accepted": "CompleteRegistration",
};

async function sendToMeta({ metaEventName, investor, deal, dealmakerEventId }) {
  const pixelId   = process.env.META_PIXEL_ID;
  const capiToken = process.env.META_CAPI_TOKEN;

  if (!pixelId || !capiToken) {
    console.warn("⚠️  META_PIXEL_ID or META_CAPI_TOKEN not set — skipping CAPI call");
    return;
  }

  const user_data = {
    em: sha256(investor.email),
    ph: sha256(normalizePhone(investor.phone_number)),
    fn: sha256(investor.first_name),
    ln: sha256(investor.last_name),
  };

  Object.keys(user_data).forEach((k) => user_data[k] === undefined && delete user_data[k]);

  const custom_data = {
    currency: investor.investor_currency || deal?.currency || "USD",
    value: investor.investment_amount ?? 0,
    content_name: deal?.title,
    content_category: deal?.deal_type,
    ...(investor.utm_parameters && {
      utm_source:   investor.utm_parameters.utm_source,
      utm_campaign: investor.utm_parameters.utm_campaign,
      utm_medium:   investor.utm_parameters.utm_medium,
      utm_content:  investor.utm_parameters.utm_content,
      utm_term:     investor.utm_parameters.utm_term,
    }),
  };

  Object.keys(custom_data).forEach((k) => custom_data[k] === undefined && delete custom_data[k]);

  const payload = {
    data: [
      {
        event_name:    metaEventName,
        event_id:      dealmakerEventId,
        event_time:    Math.floor(Date.now() / 1000),
        action_source: "website",
        user_data,
        custom_data,
      },
    ],
    test_event_code: "TEST35692", // ← uncomment to test in Meta Test Events tab
  };

  const url = `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${capiToken}`;

  const response = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
  });

  const result = await response.json();

  if (!response.ok) {
    console.error("❌ Meta CAPI error:", JSON.stringify(result));
  } else {
    console.log("📡 Meta CAPI sent:", metaEventName, "| events_received:", result.events_received);
  }
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

    const headerSig =
      req.headers["x-dealmaker-signature"] ||
      req.headers["x-dealmaker-signature".toLowerCase()];

    if (!headerSig) {
      return res.status(401).json({ ok: false, error: "Missing X-Dealmaker-Signature" });
    }

    const received = String(headerSig).replace(/^sha1=/i, "").trim();
    const expected = crypto.createHmac("sha1", secret).update(rawBody).digest("hex");

    const a = Buffer.from(received, "hex");
    const b = Buffer.from(expected, "hex");
    const match = a.length === b.length && crypto.timingSafeEqual(a, b);

    if (!match) {
      return res.status(401).json({ ok: false, error: "Invalid signature" });
    }

    const body = JSON.parse(rawBody);
    const { event: dealmakerEvent, event_id: dealmakerEventId, deal, investor } = body;

    console.log("✅ Verified webhook:", {
      event: dealmakerEvent,
      event_id: dealmakerEventId,
      deal_id: deal?.id,
      investor_state: investor?.state,
    });

    const metaEventName = EVENT_MAP[dealmakerEvent];

    if (!metaEventName) {
      console.log("ℹ️  No Meta mapping for event:", dealmakerEvent, "— ignoring");
      return res.status(200).json({ ok: true });
    }

    if (!investor) {
      console.warn("⚠️  Webhook has no investor payload — skipping CAPI");
      return res.status(200).json({ ok: true });
    }

    await sendToMeta({ metaEventName, investor, deal, dealmakerEventId });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(400).json({ ok: false, error: "Bad webhook payload" });
  }
}