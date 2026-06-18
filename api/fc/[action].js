// Single serverless function that fans out to the fc-* handlers.
//
// Vercel's Hobby plan caps a deployment at 12 Serverless Functions. The 10
// fc-* endpoints used to be one function each; they now live in /fc-routes
// (outside /api, so they no longer count as functions) and this router
// dispatches to them. A rewrite in vercel.json maps the original
// /api/fc-<action> URLs to /api/fc/<action>, so the frontend is unchanged.
//
// Requiring the handler modules here only loads lib/fc (light); the heavy
// deps (@solana/web3.js, etc.) stay lazily required inside lib/fc, so cold
// starts are unaffected.
const handlers = {
  account: require("../../fc-routes/fc-account"),
  bet: require("../../fc-routes/fc-bet"),
  challenge: require("../../fc-routes/fc-challenge"),
  config: require("../../fc-routes/fc-config"),
  "deposit-check": require("../../fc-routes/fc-deposit-check"),
  leaderboard: require("../../fc-routes/fc-leaderboard"),
  login: require("../../fc-routes/fc-login"),
  profile: require("../../fc-routes/fc-profile"),
  "rotate-seed": require("../../fc-routes/fc-rotate-seed"),
  withdraw: require("../../fc-routes/fc-withdraw"),
};

module.exports = async (req, res) => {
  const action = String((req.query && req.query.action) || "");
  const handler = handlers[action];
  if (!handler) {
    res.statusCode = 404;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "unknown fc action", action }));
    return;
  }
  return handler(req, res);
};
