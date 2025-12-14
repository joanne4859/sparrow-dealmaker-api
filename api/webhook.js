export default async function handler(req, res) {
  // Dealmaker sends POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Log everything for now
    console.log("🔔 Dealmaker Webhook Received");
    console.log("Headers:", req.headers);
    console.log("Body:", req.body);

    // IMPORTANT: respond 200 or Dealmaker retries
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ error: "Webhook handler failed" });
  }
}
