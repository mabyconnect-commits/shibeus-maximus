// scripts/smoke-devnet.js — end-to-end devnet check of the Shibeus FC backend.
// Runs the real loop: config → sign-in → fund deposit addr (airdrop) →
// deposit-check → bet → withdraw, against your DEPLOYED app.
//
// Usage:
//   npm i
//   BASE=https://your-app.vercel.app node scripts/smoke-devnet.js
//
// Optional: PLAYER_SECRET=<base58> to reuse a player wallet across runs.
// Requires the app to be in LIVE mode (env vars set) — otherwise it reports
// not_configured and exits.

const web3 = require("@solana/web3.js");
const nacl = require("tweetnacl");
const _b = require("bs58"); const bs58 = _b && _b.default ? _b.default : _b;

const BASE = (process.env.BASE || "").replace(/\/$/, "");
const NETWORK = "devnet";
const DEVNET_RPC = process.env.SOLANA_RPC_DEVNET || "https://api.devnet.solana.com";
if (!BASE) { console.error("Set BASE=https://your-app.vercel.app"); process.exit(1); }

const post = async (path, body) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sol = (lamports) => (lamports / 1e9).toFixed(4);

(async () => {
  console.log("→ Target:", BASE, "(devnet)\n");

  // 0) config
  const cfg = await (await fetch(BASE + "/api/fc-config")).json();
  console.log("config.configured:", cfg.configured);
  if (!cfg.configured) { console.error("✗ App is in BETA (env vars not set). Add them in Vercel and redeploy."); process.exit(1); }

  // 1) player wallet
  const player = process.env.PLAYER_SECRET
    ? web3.Keypair.fromSecretKey(bs58.decode(process.env.PLAYER_SECRET))
    : web3.Keypair.generate();
  const address = player.publicKey.toBase58();
  console.log("player:", address);

  // 2) challenge → sign → login
  const ch = await post("/api/fc-challenge", { address, network: NETWORK });
  if (!ch.ok) throw new Error("challenge failed: " + JSON.stringify(ch));
  const sig = bs58.encode(Buffer.from(nacl.sign.detached(new TextEncoder().encode(ch.message), player.secretKey)));
  const login = await post("/api/fc-login", { address, network: NETWORK, nonce: ch.nonce, signature: sig });
  if (!login.ok) throw new Error("login failed: " + JSON.stringify(login));
  const token = login.token;
  const depositAddr = login.account.depositAddress;
  console.log("✓ signed in. deposit address:", depositAddr);

  // 3) fund the deposit address via devnet airdrop
  const conn = new web3.Connection(DEVNET_RPC, "confirmed");
  console.log("→ requesting 1 devnet SOL airdrop to deposit address…");
  try {
    const a = await conn.requestAirdrop(new web3.PublicKey(depositAddr), 1e9);
    await conn.confirmTransaction(a, "confirmed");
    console.log("✓ airdrop confirmed:", a);
  } catch (e) {
    console.log("! airdrop failed (devnet faucet is flaky). Fund manually:");
    console.log("  solana airdrop 1", depositAddr, "--url devnet");
    console.log("  then re-run, or continue if already funded.");
  }
  await sleep(2000);

  // 4) deposit-check (sweep + credit)
  const dep = await post("/api/fc-deposit-check", { address, token, network: NETWORK });
  console.log("deposit-check:", JSON.stringify(dep));
  if (!dep.ok || dep.balance <= 0) { console.error("✗ no balance credited — fund the deposit address and re-run."); process.exit(1); }

  // 5) a few bets
  for (let i = 0; i < 3; i++) {
    const bet = await post("/api/fc-bet", { address, token, network: NETWORK, side: "goal", stake: 0.05, zone: i === 0 ? "TL" : null, zoneStake: i === 0 ? 0.02 : 0 });
    if (!bet.ok) { console.error("✗ bet failed:", JSON.stringify(bet)); break; }
    console.log(`bet ${i + 1}: ${bet.outcome} → ${bet.land} | net ${bet.net} | balance ${bet.account.balance}`);
  }

  // 6) withdraw back to the player wallet
  const wd = await post("/api/fc-withdraw", { address, token, network: NETWORK, destination: address, amount: 0.05 });
  console.log("withdraw:", JSON.stringify(wd));
  if (wd.ok && wd.signature) console.log("✓ withdrawal tx:", "https://explorer.solana.com/tx/" + wd.signature + "?cluster=devnet");

  console.log("\n✓ Smoke test complete.");
})().catch((e) => { console.error("✗", e.message || e); process.exit(1); });
