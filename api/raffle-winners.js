// /api/raffle-winners.js — returns recent raffle champions (from KV).
// Safe no-op (empty list) until KV is configured.
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=30");
  try {
    if (!process.env.KV_REST_API_URL) return res.status(200).json([]);
    const { kv } = require("@vercel/kv");
    const raw = (await kv.lrange("raffle:winners", 0, 9)) || [];
    const list = raw.map((r) => (typeof r === "string" ? JSON.parse(r) : r));
    return res.status(200).json(list);
  } catch (e) {
    return res.status(200).json([]);
  }
};
