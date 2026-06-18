// POST /api/fc-rotate-seed — reveal the player's current server seed (so past
// shots under it can be verified) and commit a fresh one.
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
    const crypto = require("crypto");

    const a = await fc.getAccount(b.address);
    const revealedSeed = a.server, revealedHash = a.hash, revealedNonce = a.nonce;
    a.server = crypto.randomBytes(32).toString("hex");
    a.hash = fc.sha256Hex(a.server);
    if (b.clientSeed && /^[A-Za-z0-9_-]{1,64}$/.test(b.clientSeed)) a.client = String(b.clientSeed);
    a.nonce = 0;
    await fc.putAccount(a);

    return res.status(200).json({
      ok: true,
      revealed: { serverSeed: revealedSeed, serverSeedHash: revealedHash, nonceCount: revealedNonce },
      next: { serverSeedHash: a.hash, clientSeed: a.client, nonce: 0 },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "rotate_failed", detail: String(e) });
  }
};
