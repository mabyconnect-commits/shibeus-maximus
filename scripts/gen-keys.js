// scripts/gen-keys.js — generate a treasury keypair + secrets for Shibeus FC.
// Usage: npm i && node scripts/gen-keys.js
// Prints env-ready values. NEVER commit the output. For mainnet, run this on a
// machine you trust and paste the secret only into Vercel's encrypted env vars.
const crypto = require("crypto");
const web3 = require("@solana/web3.js");
const _b = require("bs58"); const bs58 = _b && _b.default ? _b.default : _b;

const kp = web3.Keypair.generate();
const out = {
  TREASURY_PUBKEY_fund_this: kp.publicKey.toBase58(),
  TREASURY_SECRET: bs58.encode(kp.secretKey),
  FC_MASTER_SEED: crypto.randomBytes(32).toString("hex"),
  FC_SESSION_SECRET: crypto.randomBytes(32).toString("hex"),
};
console.log("\n=== Shibeus FC — generated credentials (KEEP SECRET) ===\n");
console.log("Fund this address (airdrop on devnet / send SOL on mainnet):");
console.log("  " + out.TREASURY_PUBKEY_fund_this + "\n");
console.log("Paste these into Vercel → Settings → Environment Variables:");
for (const k of ["TREASURY_SECRET", "FC_MASTER_SEED", "FC_SESSION_SECRET"]) console.log("  " + k + "=" + out[k]);
console.log("\nReminder: also add Upstash KV, and set SOLANA_RPC_DEVNET / SOLANA_RPC_MAINNET.\n");
