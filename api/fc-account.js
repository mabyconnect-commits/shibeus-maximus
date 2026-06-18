// POST /api/fc-account — authed account snapshot (balance, stats, deposit addr).
// Body: { address, token }
const fc = require("../lib/fc");

module.exports = async (req, res) => {
  fc.cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!fc.cfg().configured) return res.status(200).json({ ok: false, reason: "not_configured" });

  try {
    const b = fc.body(req);
    if (!fc.authed(b)) return res.status(401).json({ error: "unauthorized" });
    const net = fc.normNet(b.network);
    const a = await fc.getAccount(net, b.address);
    return res.status(200).json({ ok: true, account: fc.publicAccount(a, fc.depositAddress(net, b.address)) });
  } catch (e) {
    return res.status(500).json({ error: "account_failed", detail: String(e) });
  }
};
