// POST /api/fc-withdraw — pay SOL from the treasury to the player's wallet and
// debit their game balance. Large amounts go to a manual review queue.
// Body: { address, token, destination, amount }
const fc = require("../lib/fc");

module.exports = async (req, res) => {
  fc.cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!fc.cfg().configured) return res.status(200).json({ ok: false, reason: "not_configured" });

  try {
    const b = fc.body(req);
    if (!fc.authed(b)) return res.status(401).json({ error: "unauthorized" });

    const destination = String(b.destination || b.address).trim();
    if (!fc.isAddress(destination)) return res.status(400).json({ ok: false, error: "bad_destination" });

    const amount = fc.round9(Number(b.amount));
    if (!(amount >= fc.ECON.MIN_WITHDRAW)) return res.status(400).json({ ok: false, error: "below_min", min: fc.ECON.MIN_WITHDRAW });

    // Lock the account so concurrent withdrawals can't double-spend the balance.
    const lock = await fc.withLock(`wd:${b.address}`, async () => {
    const a = await fc.getAccount(b.address);
    if (amount > a.balance + 1e-9) return { http: 400, payload: { ok: false, error: "insufficient", balance: a.balance } };

    // Debit first to prevent double-spend; refund on send failure.
    a.balance = fc.round9(a.balance - amount);
    await fc.putAccount(a);

    // Large amounts: queue for manual review instead of auto-sending.
    if (amount > fc.ECON.AUTO_WITHDRAW_MAX) {
      try {
        await fc.kv().lpush("fc:withdraw-queue", JSON.stringify({ address: b.address, destination, amount, t: Date.now() }));
      } catch (_) {}
      return { http: 200, payload: { ok: true, queued: true, amount, balance: a.balance } };
    }

    try {
      const web3 = fc.web3();
      const conn = new web3.Connection(fc.cfg().RPC, "confirmed");
      const treasury = fc.treasuryKeypair();
      const tx = new web3.Transaction().add(
        web3.SystemProgram.transfer({
          fromPubkey: treasury.publicKey,
          toPubkey: new web3.PublicKey(destination),
          lamports: Math.floor(amount * fc.ECON.LAMPORTS),
        })
      );
      tx.feePayer = treasury.publicKey;
      const { blockhash } = await conn.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      const sig = await web3.sendAndConfirmTransaction(conn, tx, [treasury], { commitment: "confirmed" });
      return { http: 200, payload: { ok: true, amount, signature: sig, balance: a.balance } };
    } catch (sendErr) {
      // refund the debit
      const a2 = await fc.getAccount(b.address);
      a2.balance = fc.round9(a2.balance + amount);
      await fc.putAccount(a2);
      return { http: 502, payload: { ok: false, error: "send_failed", refunded: true, balance: a2.balance, detail: String(sendErr) } };
    }
    });
    if (lock.error === "busy") return res.status(429).json({ ok: false, error: "busy" });
    return res.status(lock.http).json(lock.payload);
  } catch (e) {
    return res.status(500).json({ ok: false, error: "withdraw_failed", detail: String(e) });
  }
};
