// POST /api/fc-deposit-check — sweep any SOL sitting on the user's derived
// deposit address into the treasury and credit their game balance.
// Idempotent by construction: we sweep the address to ~0, so re-checks find nothing.
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

    const result = await fc.withLock(`dep:${net}:${b.address}`, async () => {
    const web3 = fc.web3();
    const conn = new web3.Connection(fc.rpcFor(net), "confirmed");
    const treasury = fc.treasuryKeypair();
    const depositKp = fc.depositKeypair(net, b.address);

    const lamports = await conn.getBalance(depositKp.publicKey, "confirmed");
    const minLamports = Math.floor(fc.ECON.MIN_DEPOSIT * fc.ECON.LAMPORTS);
    if (lamports < minLamports) {
      const a = await fc.getAccount(net, b.address);
      return { http: 200, payload: { ok: true, credited: 0, balance: a.balance, found: lamports / fc.ECON.LAMPORTS } };
    }

    // Sweep the full balance; treasury is the fee payer so the user is credited
    // the entire deposited amount.
    const tx = new web3.Transaction().add(
      web3.SystemProgram.transfer({
        fromPubkey: depositKp.publicKey,
        toPubkey: treasury.publicKey,
        lamports,
      })
    );
    tx.feePayer = treasury.publicKey;
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    const sig = await web3.sendAndConfirmTransaction(conn, tx, [treasury, depositKp], { commitment: "confirmed" });

    const credited = lamports / fc.ECON.LAMPORTS;
    const a = await fc.getAccount(net, b.address);
    a.balance = fc.round9(a.balance + credited);
    a.creditedLamports = (a.creditedLamports || 0) + lamports;
    await fc.putAccount(a);

    return { http: 200, payload: { ok: true, credited, balance: a.balance, signature: sig } };
    });
    if (result.error === "busy") return res.status(429).json({ ok: false, error: "busy" });
    return res.status(result.http).json(result.payload);
  } catch (e) {
    return res.status(500).json({ ok: false, error: "deposit_check_failed", detail: String(e) });
  }
};
