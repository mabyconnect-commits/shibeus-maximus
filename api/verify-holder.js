// /api/verify-holder.js — REAL on-chain check (no wallet connect)
// Verifies a Solana address holds >= MIN_HOLD $SHIBEUS via RPC.
const MINT = "D6u44BYArAHF4zqEpq2T4VCuLSHR3bKXnZfvoDjmpump";
const MIN_HOLD = 50000;
const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const address = String(body.address || "").trim();

    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      return res.status(400).json({ error: "Invalid Solana address" });
    }

    const rpcRes = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [address, { mint: MINT }, { encoding: "jsonParsed" }],
      }),
    });
    const data = await rpcRes.json();

    if (data.error) {
      return res.status(502).json({ error: "RPC error", detail: data.error.message });
    }

    let balance = 0;
    for (const a of data?.result?.value || []) {
      balance += a.account.data.parsed.info.tokenAmount.uiAmount || 0;
    }

    return res.status(200).json({
      address,
      balance,
      eligible: balance >= MIN_HOLD,
      min: MIN_HOLD,
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: String(e) });
  }
};
