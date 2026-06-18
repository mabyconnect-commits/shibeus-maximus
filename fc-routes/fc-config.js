// GET /api/fc-config — does the server have everything to run live SOL play?
const fc = require("../lib/fc");

module.exports = async (req, res) => {
  fc.cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  const c = fc.cfg();
  return res.status(200).json({
    configured: c.configured,
    networks: fc.NETWORKS,
    defaultNetwork: "devnet",
    econ: {
      mainMult: fc.ECON.MAIN_MULT, zoneMult: fc.ECON.ZONE_MULT,
      minBet: fc.ECON.MIN_BET, maxBet: fc.ECON.MAX_BET,
      minDeposit: fc.ECON.MIN_DEPOSIT, minWithdraw: fc.ECON.MIN_WITHDRAW,
    },
  });
};
