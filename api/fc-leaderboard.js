// GET /api/fc-leaderboard?mode=profit|wagered — public top players.
const fc = require("../lib/fc");

module.exports = async (req, res) => {
  fc.cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!fc.cfg().configured) return res.status(200).json({ ok: false, reason: "not_configured", rows: [] });

  try {
    const mode = (req.query && req.query.mode) === "wagered" ? "wagered" : "profit";
    const net = fc.normNet(req.query && req.query.network);
    const rows = await fc.leaderboard(net, mode, 12);
    return res.status(200).json({ ok: true, mode, network: net, rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "leaderboard_failed", detail: String(e), rows: [] });
  }
};
