// POST /api/fc-login — verify the signed challenge, issue a session token.
// Body: { address, nonce, signature }  (signature = base58 of signMessage output)
const fc = require("../lib/fc");

module.exports = async (req, res) => {
  fc.cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!fc.cfg().configured) return res.status(200).json({ ok: false, reason: "not_configured" });

  try {
    const b = fc.body(req);
    if (!fc.isAddress(b.address)) return res.status(400).json({ error: "bad_address" });
    const net = fc.normNet(b.network);
    // single-use challenge must match (and is consumed here)
    if (!(await fc.consumeChallenge(net, b.address, b.nonce))) return res.status(401).json({ error: "bad_or_expired_challenge" });
    const message = fc.loginMessage(b.address, b.nonce, net);
    if (!fc.verifySignature(b.address, message, String(b.signature || ""))) return res.status(401).json({ error: "bad_signature" });

    const token = fc.issueToken(b.address); // identity token; network is per-request
    const a = await fc.getAccount(net, b.address);
    return res.status(200).json({ ok: true, token, account: fc.publicAccount(a, fc.depositAddress(net, b.address)) });
  } catch (e) {
    return res.status(500).json({ error: "login_failed", detail: String(e) });
  }
};
