// /api/claim.js — sends $SHIBEUS from the treasury for redeemed points.
// Activates automatically once these encrypted env vars are set in Vercel:
//   TREASURY_SECRET  - base58 secret key of the funded treasury wallet
//   SOLANA_RPC       - (optional) RPC endpoint, defaults to mainnet-beta
// Points are read/decremented from a KV store (set KV_REST_API_URL/KV_REST_API_TOKEN).
// Until configured, returns { ok:false, reason:"not_configured" } so the BETA UI
// can show "claims open at launch" instead of failing.

const MINT = "D6u44BYArAHF4zqEpq2T4VCuLSHR3bKXnZfvoDjmpump";
const POINTS_PER_TOKEN = 10; // 1,000 points = 100 $SHIBEUS  ->  10 points = 1 token
const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // Graceful degradation while treasury isn't funded/configured yet.
  if (!process.env.TREASURY_SECRET) {
    return res.status(200).json({ ok: false, reason: "not_configured" });
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const address = String(body.address || "").trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      return res.status(400).json({ error: "Invalid Solana address" });
    }

    // ---- server-authoritative points ----
    const { kv } = require("@vercel/kv");
    const key = `points:${address}`;
    const points = Number((await kv.get(key)) || 0);
    if (points < POINTS_PER_TOKEN) {
      return res.status(200).json({ ok: false, reason: "no_points", points });
    }
    const tokens = Math.floor(points / POINTS_PER_TOKEN);
    const spend = tokens * POINTS_PER_TOKEN;

    // ---- on-chain transfer ----
    const web3 = require("@solana/web3.js");
    const splToken = require("@solana/spl-token");
    const bs58 = require("bs58");

    const conn = new web3.Connection(RPC, "confirmed");
    const treasury = web3.Keypair.fromSecretKey(bs58.decode(process.env.TREASURY_SECRET));
    const mint = new web3.PublicKey(MINT);
    const dest = new web3.PublicKey(address);

    const mintInfo = await splToken.getMint(conn, mint);
    const amount = BigInt(tokens) * 10n ** BigInt(mintInfo.decimals);

    const fromAta = await splToken.getOrCreateAssociatedTokenAccount(conn, treasury, mint, treasury.publicKey);
    const toAta = await splToken.getOrCreateAssociatedTokenAccount(conn, treasury, mint, dest);

    const sig = await splToken.transfer(
      conn, treasury, fromAta.address, toAta.address, treasury.publicKey, amount
    );

    // deduct spent points
    await kv.set(key, points - spend);

    return res.status(200).json({ ok: true, tokens, signature: sig, remainingPoints: points - spend });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "claim_failed", detail: String(e) });
  }
};
