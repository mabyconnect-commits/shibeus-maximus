// POST /api/fc-challenge — issue a single-use sign-in nonce for an address.
// Body: { address }  →  { ok, nonce, message }
const fc = require("../lib/fc");

module.exports = async (req, res) => {
  fc.cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!fc.cfg().configured) return res.status(200).json({ ok: false, reason: "not_configured" });

  try {
    const b = fc.body(req);
    if (!fc.isAddress(b.address)) return res.status(400).json({ error: "bad_address" });
    const { nonce, message } = await fc.issueChallenge(b.address);
    return res.status(200).json({ ok: true, nonce, message });
  } catch (e) {
    return res.status(500).json({ error: "challenge_failed", detail: String(e) });
  }
};
