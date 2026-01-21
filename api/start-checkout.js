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

    // STEP 1: VALIDATE MINIMAL REQUIRED FIELDS
    // Only require email and investment amount initially
    const email = requireField(body, "email");
    const investment_value = requireField(body, "investment_value");

    // Optional fields for initial submission
    const first_name = body.first_name || "";
    const last_name = body.last_name || "";
    const phone_number = body.phone_number || "";

    // Optional profile fields (can be collected later in checkout)
    const date_of_birth = body.date_of_birth;
    const taxpayer_id = body.taxpayer_id;
    const country = body.country;
    const street_address = body.street_address;
    const city = body.city;
    const region = body.region;
    const postal_code = body.postal_code;
    const unit2 = body.unit2;
    
    // Optional: is_accredited (for internal tracking)
    const is_accredited = body.is_accredited || false;

    if (is_accredited) {
      console.log(`Investor ${email} selected 'Accredited' on the landing page.`);
    }

    // Get OAuth token
    const accessToken = await getAccessToken();

    // STEP 2: CREATE INVESTMENT FIRST (PRIORITY)
    // This ensures the investment is recorded even if profile creation fails
    const investorPayload = {
      email,
      email_confirmation: email,
      first_name: first_name || email.split("@")[0], // Use email prefix as fallback
      last_name: last_name || "Unknown",
      phone_number: phone_number || "",
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
      const errorText = await investorRes.text();
      let errorDetails;
      try {
        errorDetails = JSON.parse(errorText);
      } catch {
        errorDetails = { raw: errorText };
      }

      // Provide specific error feedback
      return res.status(investorRes.status).json({
        error: "Failed to create investment",
        message: "Unable to process your investment. Please check the information provided.",
        details: errorDetails,
        field_errors: errorDetails.errors || null,
        status_code: investorRes.status
      });
    }

    const investorJson = await investorRes.json();
    const dealInvestorId = investorJson.id;

    console.log(`✓ Investment created successfully: Deal Investor ID ${dealInvestorId}`);

    // STEP 3: CREATE INVESTOR PROFILE (IF DATA AVAILABLE)
    let investor_profile_id = null;
    
    // Only attempt to create profile if we have the minimum required profile fields
    const hasMinimalProfileData = date_of_birth && taxpayer_id && country && 
                                   street_address && city && region && postal_code;

    if (hasMinimalProfileData) {
      try {
        const profilePayload = {
          investor_type: "individual",
          email,
          first_name: first_name || email.split("@")[0],
          last_name: last_name || "Unknown",
          date_of_birth,
          taxpayer_id,
          phone_number: phone_number || "",
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

        if (profileRes.ok) {
          const profileJson = await profileRes.json();
          investor_profile_id = profileJson.id;
          console.log(`✓ Investor profile created: Profile ID ${investor_profile_id}`);

          // STEP 4: PATCH INVESTMENT WITH PROFILE ID
          const patchRes = await fetch(
            `${process.env.DEALMAKER_BASE_URL}/deals/${DEAL_ID}/investors/${dealInvestorId}`,
            {
              method: "PATCH",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({ investor_profile_id }),
            }
          );

          if (patchRes.ok) {
            console.log(`✓ Investment updated with profile ID ${investor_profile_id}`);
          } else {
            const patchError = await patchRes.text();
            console.warn(`⚠ Failed to link profile to investment: ${patchError}`);
            // Don't fail the request - investment is still created
          }
        } else {
          const profileError = await profileRes.text();
          console.warn(`⚠ Profile creation failed (non-blocking): ${profileError}`);
          // Don't fail the request - investment is still created
        }
      } catch (profileErr) {
        console.warn(`⚠ Profile creation error (non-blocking): ${profileErr.message}`);
        // Don't fail the request - investment is still created
      }
    } else {
      console.log(`ℹ Skipping profile creation - insufficient data provided (will be collected in checkout)`);
    }

    // STEP 5: GENERATE OTP ACCESS LINK
    const redirect_url = `https://app.dealmaker.tech/deals/${DEAL_ID}/investors/${dealInvestorId}/otp_access`;

    return res.status(200).json({
      success: true,
      redirect_url,
      deal_investor_id: dealInvestorId,
      investor_profile_id: investor_profile_id || null,
      profile_created: !!investor_profile_id,
      message: investor_profile_id 
        ? "Investment and profile created successfully"
        : "Investment created successfully. Additional information will be collected during checkout."
    });

  } catch (err) {
    // Improved error handling with specific feedback
    const errorMessage = err?.message || String(err);
    
    // Check if it's a missing field error
    if (errorMessage.includes("Missing required field")) {
      const fieldName = errorMessage.split(":")[1]?.trim();
      return res.status(400).json({
        error: "Missing required information",
        message: `Please provide your ${fieldName || "required information"}`,
        field: fieldName,
        status_code: 400
      });
    }

    // Generic server error
    return res.status(500).json({
      error: "Server error",
      message: "An unexpected error occurred. Please try again or contact support.",
      details: errorMessage,
      status_code: 500
    });
  }
}