// api/start-checkout.js

import { getAccessToken } from "./_dealmakerAuth.js";

const DEAL_ID = 4210;

function requireField(obj, key) {
  if (!obj?.[key]) throw new Error(`Missing required field: ${key}`);
  return obj[key];
}

function toFormUrlEncoded(data) {
  const params = new URLSearchParams();
  Object.entries(data).forEach(([k, v]) => {
    // Only append if the value is not undefined, null, or empty string
    if (v === undefined || v === null) return;
    params.append(k, String(v));
  });
  return params.toString();
}

export default async function handler(req, res) {
  // --- CORS (for Webflow -> Vercel calls) ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Preflight request (browser sends OPTIONS before POST)
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // Basic fields
    const email = requireField(body, "email");
    const first_name = requireField(body, "first_name");
    const last_name = requireField(body, "last_name");
    const phone_number = requireField(body, "phone_number");

    // Required profile fields (collected on WebFlow)
    const date_of_birth = requireField(body, "date_of_birth"); // expect YYYY-MM-DD
    const taxpayer_id = requireField(body, "taxpayer_id");
    const country = requireField(body, "country");
    const street_address = requireField(body, "street_address");
    const city = requireField(body, "city");
    const region = requireField(body, "region");
    const postal_code = requireField(body, "postal_code");

    // Investment fields
    const investment_value = requireField(body, "investment_value"); // dollars as number/string

    // Optional
    const unit2 = body.unit2;
    
    // OPTIONAL FIELD: is_accredited (for your internal tracking)
    // NOTE: This defaults to false if not present, and is NOT sent to DealMaker.
    const is_accredited = body.is_accredited || false; 

    if (is_accredited) {
        // You can log this for your internal Vercel logs
        console.log(`Investor ${email} selected 'Accredited' on the landing page.`);
    }

    // 1) OAuth token
    const accessToken = await getAccessToken();

    // 2) Create individual investor profile (FORM URLENCODED)
    const profilePayload = {
      investor_type: "individual",
      email,
      first_name,
      last_name,
      date_of_birth,
      taxpayer_id,
      phone_number,
      country,
      street_address,
      unit2,
      city,
      region,
      postal_code
    };

    const profileRes = await fetch(
      `${process.env.DEALMAKER_BASE_URL}/investor_profiles/individuals`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: toFormUrlEncoded(profilePayload),
      }
    );

    if (!profileRes.ok) {
      const text = await profileRes.text();
      return res.status(profileRes.status).json({
        error: "Failed to create investor profile",
        details: text,
      });
    }

    const profileJson = await profileRes.json();
    const investor_profile_id = profileJson.id;

    // 3) Create deal investor (JSON)
    const investorPayload = {
      email,
      email_confirmation: email,
      investor_profile_id,
      first_name,
      last_name,
      phone_number,
      investment_value: Number(investment_value).toFixed(2),
      allocation_unit: "amount"
    };

    const investorRes = await fetch(
      `${process.env.DEALMAKER_BASE_URL}/deals/${DEAL_ID}/investors`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(investorPayload),
      }
    );

    if (!investorRes.ok) {
      const text = await investorRes.text();
      return res.status(investorRes.status).json({
        error: "Failed to create deal investor",
        details: text,
      });
    }

    const investorJson = await investorRes.json();

    // 4) Get OTP access link (this triggers phone verification -> then checkout flow)
    const dealInvestorId = investorJson.id;

    const redirect_url = `https://app.dealmaker.tech/deals/${DEAL_ID}/investors/${dealInvestorId}/otp_access`;

    return res.status(200).json({
      redirect_url,
      deal_investor_id: dealInvestorId,
      investor_profile_id,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      message: err?.message || String(err),
    });
  }
}