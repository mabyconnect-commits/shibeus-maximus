// /api/raffle-draw.js — hourly raffle draw + payout (run by Vercel Cron, see vercel.json).
// Picks one random entrant (weighted by entries) and sends the whole pot to them.
// Entries are recorded when players send $SHIBEUS to the raffle wallet; an indexer
// (or webhook) writes them into KV under `raffle:current:entries` as [{address, weight}].
// Activates once TREASURY_SECRET + KV are configured. Until then it no-ops safely.

const MINT = "D6u44BYArAHF4zqEpq2T4VCuLSHR3bKXnZfvoDjmpump";
const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";

module.exports = async (req, res) => {
  // Only allow Vercel Cron (it sends this header) or a manual secret.
  const isCron = req.headers["x-vercel-cron"] === "1";
  const okSecret = process.env.CRON_SECRET && req.query?.secret === process.env.CRON_SECRET;
  if (!isCron && !okSecret) return res.status(401).json({ error: "unauthorized" });

  if (!process.env.TREASURY_SECRET) {
    return res.status(200).json({ ok: false, reason: "not_configured" });
  }

  try {
    const { kv } = require("@vercel/kv");
    const entries = (await kv.get("raffle:current:entries")) || [];
    if (!entries.length) return res.status(200).json({ ok: true, drawn: null, reason: "no_entries" });

    // weighted random pick
    const total = entries.reduce((s, e) => s + (e.weight || 1), 0);
    let r = Math.random() * total;
    let winner = entries[entries.length - 1];
    for (const e of entries) { r -= (e.weight || 1); if (r <= 0) { winner = e; break; } }

    // pot = current balance of the raffle wallet's $SHIBEUS ATA
    const web3 = require("@solana/web3.js");
    const splToken = require("@solana/spl-token");
    const bs58 = require("bs58");

    const conn = new web3.Connection(RPC, "confirmed");
    const treasury = web3.Keypair.fromSecretKey(bs58.decode(process.env.TREASURY_SECRET));
    const mint = new web3.PublicKey(MINT);

    const fromAta = await splToken.getOrCreateAssociatedTokenAccount(conn, treasury, mint, treasury.publicKey);
    const bal = await conn.getTokenAccountBalance(fromAta.address);
    const pot = BigInt(bal.value.amount);
    if (pot === 0n) return res.status(200).json({ ok: true, drawn: winner.address, reason: "empty_pot" });

    const toAta = await splToken.getOrCreateAssociatedTokenAccount(
      conn, treasury, mint, new web3.PublicKey(winner.address)
    );
    const sig = await splToken.transfer(
      conn, treasury, fromAta.address, toAta.address, treasury.publicKey, pot
    );

    // archive + reset round
    const round = { winner: winner.address, amount: bal.value.uiAmount, signature: sig, ts: Date.now() };
    await kv.lpush("raffle:winners", JSON.stringify(round));
    await kv.set("raffle:current:entries", []);

    return res.status(200).json({ ok: true, ...round });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "draw_failed", detail: String(e) });
  }
};
