// lib/fc.js — Shibeus FC shared server library
// Custodial game-balance engine: config, KV access, wallet-signature auth,
// HMAC session tokens, per-user derived deposit addresses, and a
// server-authoritative provably-fair penalty settlement.
//
// Everything degrades gracefully: if the required env vars aren't set the
// API reports `configured:false` and the frontend stays on free BETA credits.

const crypto = require("crypto");

/* ---------- Economics (must match fc.js on the client) ---------- */
const ECON = {
  MAIN_MULT: 1.98,
  ZONE_MULT: 9.9,
  P_GOAL: 0.5,
  MIN_BET: 0.01,
  MAX_BET: Number(process.env.FC_MAX_BET || 5), // safety cap (SOL)
  ZONES_LAND: ["TL", "TR", "BL", "BR", "C"],
  MIN_WITHDRAW: 0.005,
  MIN_DEPOSIT: 0.01,
  AUTO_WITHDRAW_MAX: Number(process.env.FC_AUTO_WITHDRAW_MAX || 2), // above this → review queue
  LAMPORTS: 1_000_000_000,
};

/* ---------- Config ---------- */
function cfg() {
  const TREASURY_SECRET = process.env.TREASURY_SECRET || "";
  const MASTER_SEED = process.env.FC_MASTER_SEED || "";
  const SESSION_SECRET = process.env.FC_SESSION_SECRET || "";
  const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
  const hasKV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  // "configured" = we can run the full custodial flow
  const configured = !!(TREASURY_SECRET && MASTER_SEED && SESSION_SECRET && hasKV);
  return { TREASURY_SECRET, MASTER_SEED, SESSION_SECRET, RPC, hasKV, configured };
}

/* ---------- KV ---------- */
function kv() {
  return require("@vercel/kv").kv;
}

/* ---------- HTTP helpers ---------- */
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
}
function body(req) {
  return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
}
const isAddress = (a) => typeof a === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);

/* ---------- Auth: challenge → wallet signature → session token ---------- */
// Flow: client asks for a single-use challenge nonce (stored in KV, short TTL);
// signs the exact message with Phantom; server re-checks the nonce, verifies the
// signature, consumes the nonce, and issues a time-boxed HMAC session token.
// The single-use nonce makes captured signatures non-replayable.
const chalKey = (a) => `fc:chal:${a}`;
function loginMessage(address, nonce) {
  return `Shibeus FC — sign in\nWallet: ${address}\nNonce: ${nonce}\nThis only proves you own the wallet. It is free and sends nothing.`;
}
async function issueChallenge(address) {
  const nonce = crypto.randomBytes(16).toString("hex");
  await kv().set(chalKey(address), nonce, { ex: 300 }); // 5-minute TTL
  return { nonce, message: loginMessage(address, nonce) };
}
async function consumeChallenge(address, nonce) {
  const stored = await kv().get(chalKey(address));
  if (!stored || String(stored) !== String(nonce)) return false;
  await kv().del(chalKey(address)); // single use
  return true;
}
function verifySignature(address, message, signatureB58) {
  const nacl = require("tweetnacl");
  const bs58 = bs58lib();
  try {
    const msg = new TextEncoder().encode(message);
    const sig = bs58.decode(signatureB58);
    const pub = bs58.decode(address);
    return nacl.sign.detached.verify(msg, sig, pub);
  } catch (_) {
    return false;
  }
}
function issueToken(address, ttlMs = 24 * 60 * 60 * 1000) {
  const { SESSION_SECRET } = cfg();
  const exp = Date.now() + ttlMs;
  const mac = crypto.createHmac("sha256", SESSION_SECRET).update(`${address}|${exp}`).digest("hex");
  return `${exp}.${mac}`;
}
function verifyToken(address, token) {
  const { SESSION_SECRET } = cfg();
  if (typeof token !== "string" || !token.includes(".")) return false;
  const [exp, mac] = token.split(".");
  if (!exp || !mac || Date.now() > Number(exp)) return false;
  const good = crypto.createHmac("sha256", SESSION_SECRET).update(`${address}|${exp}`).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(mac, "hex"), Buffer.from(good, "hex"));
  } catch (_) {
    return false;
  }
}
// pulls {address, token} from body and authorizes
function authed(b) {
  return isAddress(b.address) && verifyToken(b.address, b.token);
}

/* ---------- Per-user lock (guards read-modify-write money paths) ---------- */
async function withLock(name, fn) {
  const lk = `fc:lock:${name}`;
  const got = await kv().set(lk, 1, { nx: true, ex: 30 });
  if (!got) return { error: "busy" };
  try { return await fn(); }
  finally { try { await kv().del(lk); } catch (_) {} }
}

/* ---------- Provably fair (mirrors the client math exactly) ---------- */
function hmacFloat(serverSeed, message) {
  const d = crypto.createHmac("sha256", serverSeed).update(message).digest();
  return d.readUInt32BE(0) / 2 ** 32;
}
const sha256Hex = (s) => crypto.createHash("sha256").update(s).digest("hex");

/* ---------- Accounts (KV) ---------- */
const acctKey = (a) => `fc:acct:${a}`;
const histKey = (a) => `fc:hist:${a}`;

function freshAccount(address) {
  const server = crypto.randomBytes(32).toString("hex");
  return {
    address,
    balance: 0,
    handle: "",
    shots: 0, wins: 0, streak: 0, best: 0, wagered: 0, pnl: 0,
    server, hash: sha256Hex(server), client: crypto.randomBytes(8).toString("hex"), nonce: 0,
    creditedLamports: 0, // lifetime swept deposits, for audit
    createdAt: Date.now(),
  };
}
async function getAccount(address) {
  let a = await kv().get(acctKey(address));
  if (!a) { a = freshAccount(address); await kv().set(acctKey(address), a); }
  return a;
}
async function putAccount(a) {
  await kv().set(acctKey(a.address), a);
}
// Public, safe-to-expose snapshot (no server seed).
function publicAccount(a, depositAddress) {
  return {
    address: a.address, balance: a.balance, handle: a.handle,
    shots: a.shots, wins: a.wins, streak: a.streak, best: a.best, wagered: a.wagered, pnl: a.pnl,
    serverSeedHash: a.hash, clientSeed: a.client, nonce: a.nonce,
    depositAddress: depositAddress || null,
  };
}

/* ---------- Settlement ---------- */
function settle(a, { side, stake, zone, zoneStake }) {
  side = side === "miss" ? "miss" : "goal";
  stake = Number(stake);
  const wantZone = side === "goal" && zone && Number(zoneStake) >= ECON.MIN_BET;
  zoneStake = wantZone ? Number(zoneStake) : 0;
  const total = stake + zoneStake;

  if (!(stake >= ECON.MIN_BET) || stake > ECON.MAX_BET) return { error: "bad_stake" };
  if (wantZone && (zoneStake > ECON.MAX_BET || !ECON.ZONES_LAND.includes(zone))) return { error: "bad_zone" };
  if (total > a.balance + 1e-9) return { error: "insufficient" };

  const msg = `${a.client}:${a.nonce}`;
  const roll = hmacFloat(a.server, msg);
  const zoneRoll = hmacFloat(a.server, msg + ":zone");
  const outcome = roll < ECON.P_GOAL ? "goal" : "miss";
  const land = ECON.ZONES_LAND[Math.floor(zoneRoll * ECON.ZONES_LAND.length)];

  const mainProfit = side === outcome ? stake * (ECON.MAIN_MULT - 1) : -stake;
  const zoneWin = wantZone && outcome === "goal" && land === zone;
  const zoneProfit = wantZone ? (zoneWin ? zoneStake * (ECON.ZONE_MULT - 1) : -zoneStake) : 0;
  const net = round9(mainProfit + zoneProfit);

  // mutate account
  a.balance = round9(Math.max(0, a.balance + net));
  a.shots += 1;
  a.wagered = round9(a.wagered + total);
  a.pnl = round9(a.pnl + net);
  const win = net > 0;
  if (win) { a.wins += 1; a.streak = a.streak >= 0 ? a.streak + 1 : 1; if (net > a.best) a.best = net; }
  else { a.streak = a.streak <= 0 ? a.streak - 1 : -1; }

  const record = {
    side, zone: wantZone ? zone : null, outcome, land, win, net,
    main: stake, z: zoneStake,
    hash: a.hash, client: a.client, nonce: a.nonce, roll, zoneRoll, zoneWin,
    t: Date.now(),
  };
  a.nonce += 1;
  return { record, outcome, land, net, win, zoneWin, balance: a.balance };
}

const round9 = (n) => Math.round(n * 1e9) / 1e9;

/* ---------- Leaderboard ---------- */
async function bumpLeaderboard(a) {
  // store compact member; rank by profit and wagered
  const member = JSON.stringify({ h: a.handle || short(a.address), s: a.shots, p: round9(a.pnl), w: round9(a.wagered) });
  // we key the zset member by address so updates replace prior entry
  await kv().zadd("fc:lb:profit", { score: a.pnl, member: a.address });
  await kv().zadd("fc:lb:wagered", { score: a.wagered, member: a.address });
  await kv().set(`fc:lbmeta:${a.address}`, member);
}
async function leaderboard(mode = "profit", n = 12) {
  const set = mode === "wagered" ? "fc:lb:wagered" : "fc:lb:profit";
  const addrs = await kv().zrange(set, 0, n - 1, { rev: true });
  const out = [];
  for (const addr of addrs || []) {
    const meta = await kv().get(`fc:lbmeta:${addr}`);
    if (meta) { const m = typeof meta === "string" ? JSON.parse(meta) : meta; out.push({ h: m.h, shots: m.s, profit: m.p, wag: m.w }); }
  }
  return out;
}
const short = (a) => a.slice(0, 4) + "…" + a.slice(-4);

/* ---------- Solana: treasury + derived deposit addresses ---------- */
function web3() { return require("@solana/web3.js"); }
// bs58 v6 ships dual ESM/CJS; require() may hand back { default }.
function bs58lib() { const m = require("bs58"); return m && m.default ? m.default : m; }

function treasuryKeypair() {
  const { TREASURY_SECRET } = cfg();
  return web3().Keypair.fromSecretKey(bs58lib().decode(TREASURY_SECRET));
}
// Deterministic per-user deposit keypair — derived from a master seed, never stored.
function depositKeypair(address) {
  const { MASTER_SEED } = cfg();
  const seed = crypto.createHmac("sha256", MASTER_SEED).update(`fc-deposit:${address}`).digest(); // 32 bytes
  return web3().Keypair.fromSeed(seed.subarray(0, 32));
}
function depositAddress(address) {
  return depositKeypair(address).publicKey.toBase58();
}

module.exports = {
  ECON, cfg, kv, cors, body, isAddress,
  loginMessage, issueChallenge, consumeChallenge, verifySignature, issueToken, verifyToken, authed, withLock,
  hmacFloat, sha256Hex,
  acctKey, histKey, freshAccount, getAccount, putAccount, publicAccount, settle, round9,
  bumpLeaderboard, leaderboard, short,
  web3, bs58lib, treasuryKeypair, depositKeypair, depositAddress,
};
