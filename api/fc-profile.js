// POST /api/fc-profile — set the player's display handle (authed).
// Body: { address, token, handle }
const fc = require("../lib/fc");

module.exports = async (req, res) => {
  fc.cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!fc.cfg().configured) return res.status(200).json({ ok: false, reason: "not_configured" });

  try {
    const b = fc.body(req);
    if (!fc.authed(b)) return res.status(401).json({ error: "unauthorized" });
    const handle = String(b.handle || "").trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(handle)) return res.status(400).json({ ok: false, error: "bad_handle" });

    const a = await fc.getAccount(b.address);
    a.handle = handle;
    await fc.putAccount(a);
    try { await fc.bumpLeaderboard(a); } catch (_) {}
    return res.status(200).json({ ok: true, account: fc.publicAccount(a, null) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "profile_failed", detail: String(e) });
  }
};
