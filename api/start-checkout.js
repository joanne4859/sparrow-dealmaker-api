// api/start-checkout.js

import { getAccessToken } from "./_dealmakerAuth.js";

const DEAL_ID = 4127;

function requireField(obj, key) {
  if (!obj?.[key]) throw new Error(`Missing required field: ${key}`);
  return obj[key];
}

function toFormUrlEncoded(data) {
  const params = new URLSearchParams();
  Object.entries(data).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
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

    // Required profile fields (you chose to collect everything)
    const date_of_birth = requireField(body, "date_of_birth"); // expect YYYY-MM-DD
    const taxpayer_id = requireField(body, "taxpayer_id");
    const country = requireField(body, "country");
    const street_address = requireField(body, "street_address");
    const city = requireField(body, "city");
    const region = requireField(body, "region");
    const postal_code = requireField(body, "postal_code");

    // Investment fields
    const investment_value = requireField(body, "investment_value"); // dollars as number/string

    // Optional fields
    const unit2 = body.unit2;

    // >> NEW ACCREDITATION LOGIC START
    const is_accredited = body.is_accredited || false; // From WebFlow form

    let us_accredited_category = null;
    let ca_accredited_investor = false;

    if (is_accredited) {
        if (country.toUpperCase() === "CA" || country.toUpperCase() === "CANADA") {
            // Set CA status to true if country is Canada
            ca_accredited_investor = true;
        } 
        // For US, we leave us_accredited_category as null, 
        // which forces the user to select the category on the DealMaker site (Option C).
    }
    // >> NEW ACCREDITATION LOGIC END


    // 1) OAuth token
    const accessToken = await getAccessToken();

    // 2) Create individual investor profile (FORM URLENCODED)
    const profilePayload = {
      email,
      us_accredited_category,
      ca_accredited_investor,
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
      postal_code,
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
      investment_value: Number(investment_value),
      allocation_unit: "amount",
      state: "draft",
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

    const otpRes = await fetch(
      `${process.env.DEALMAKER_BASE_URL}/deals/${DEAL_ID}/investors/${dealInvestorId}/otp_access_link`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      }
    );

    if (!otpRes.ok) {
      const text = await otpRes.text();
      return res.status(otpRes.status).json({
        error: "Failed to get OTP access link",
        details: text,
        deal_investor_id: dealInvestorId,
      });
    }

    const otpJson = await otpRes.json();
    const redirect_url = otpJson.access_link;

    if (!redirect_url) {
      return res.status(500).json({
        error: "No access_link returned from otp_access_link",
        otp: otpJson,
      });
    }

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