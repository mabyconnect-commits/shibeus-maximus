# 🏛️ Arena Setup — going from BETA to live payouts

The site works right now:
- ✅ **Holder gate** (`/api/verify-holder`) does a **real** on-chain balance check.
- ✅ **Trivia-to-earn** + points + raffle countdown run live in **BETA** (points stored
  in the browser, clearly labeled "claims open at launch").

To turn on **real token payouts**, add the pieces below. None of this requires a
wallet connect from your players — it's all server-side from a treasury you control.

---

## 1. Create a treasury wallet
A normal Solana wallet that will **hold and send** the reward + raffle $SHIBEUS.
Fund it with the tokens you intend to distribute (plus a little SOL for fees).

> ⚠️ This wallet's secret key signs payouts. Use a **dedicated hot wallet**, fund it
> only with what you're comfortable distributing, and **never** paste the key in chat
> or commit it. It goes only in Vercel's encrypted environment variables.

## 2. Add a KV (Redis) store — for tamper-proof points
In the Vercel dashboard → your project → **Storage** → create an **Upstash KV/Redis**
database and "Connect" it. Vercel auto-injects:
`KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`.

> Why: browser points can be edited by users. Real claims must read points from the
> server. To make points fully server-authoritative, move the award logic into an
> `/api/answer` endpoint that validates the question server-side and writes points to
> KV (`points:<address>`). `game.js` is structured to swap to that easily.

## 3. Set environment variables (Project → Settings → Environment Variables)
| Variable | Value |
|---|---|
| `TREASURY_SECRET` | base58 secret key of the treasury wallet |
| `SOLANA_RPC` | a paid RPC URL (Helius/QuickNode) — public RPC is rate-limited |
| `CRON_SECRET` | any long random string (guards the raffle draw endpoint) |

## 4. Schedule the hourly raffle draw
`/api/raffle-draw` picks a weighted-random entrant and sends the whole pot.

- **Vercel Cron** (Pro plan): add to `vercel.json`
  ```json
  { "crons": [{ "path": "/api/raffle-draw", "schedule": "0 * * * *" }] }
  ```
  > Hobby plan only allows **daily** crons, so for hourly use an external scheduler:
- **External scheduler** (free, works on Hobby): point [cron-job.org](https://cron-job.org)
  at `https://shibeus-maximus.vercel.app/api/raffle-draw?secret=YOUR_CRON_SECRET`
  every hour.

## 5. Raffle entries (deposit watcher)
Players enter by sending $SHIBEUS to the **raffle wallet**. Run a small indexer
(Helius webhook → `/api/raffle-entry`, or a poller) that appends
`{ address, weight }` to KV key `raffle:current:entries`. The draw reads that list,
pays the winner, and resets it.

---

### Economics (already wired in `api/claim.js` + `game.js`)
- 5-minute rounds, **10,000 points** per round
- **1,000 points = 100 $SHIBEUS**  → 1,000 $SHIBEUS distributed per round
- Holder gate: **50,000 $SHIBEUS** minimum
- Raffle: entry adds to the pot, **one** random winner takes it all, hourly

### Legal note
"Pay to enter, one winner takes the pot" is a lottery mechanic and is regulated in
many jurisdictions. Confirm this is acceptable for your audience/region before launch.

---

# ⚽ Shibeus FC — going live with real SOL

`fc.html` runs a custodial penalty-betting game. It auto-detects whether the
server is configured (`/api/fc-config`):

- **BETA** (default, nothing to set up): free arena credits, client-side
  provably-fair engine. Wallet sign-in works; no real money moves.
- **LIVE**: real custodial SOL play once the env vars below are set.

### How LIVE works
1. **Sign-in.** The client requests a single-use challenge (`/api/fc-challenge`),
   the user signs it in Phantom (`signMessage`), and the server verifies the
   signature and issues a short-lived **session token** (`/api/fc-login`). All
   money endpoints require that token — captured signatures can't be replayed
   (the nonce is single-use).
2. **Deposit.** Each wallet gets a **unique deposit address** *derived* from
   `FC_MASTER_SEED` (HMAC → ed25519 keypair) — no secret keys are stored. The
   user sends native SOL there; "Check now" (`/api/fc-deposit-check`) sweeps it
   to the treasury (treasury pays the fee, so the full amount is credited).
3. **Play.** Bets settle **server-side** (`/api/fc-bet`) with the same
   provably-fair math the client shows, against the server-authoritative balance.
4. **Withdraw.** `/api/fc-withdraw` sends SOL from the treasury to the player's
   wallet and debits the balance (debit-first, auto-refund on send failure).
   Amounts over `FC_AUTO_WITHDRAW_MAX` go to the `fc:withdraw-queue` KV list for
   manual review instead of auto-sending.

### Environment variables (Project → Settings → Environment Variables)
| Variable | Value |
|---|---|
| `TREASURY_SECRET` | base58 secret key of the hot wallet that **pays withdrawals + receives swept deposits**. Keep it funded with SOL. |
| `FC_MASTER_SEED` | long random secret used to derive deposit addresses. **Never change it after launch** — deposit addresses would change. |
| `FC_SESSION_SECRET` | long random secret used to sign session tokens. |
| `SOLANA_RPC` | a paid RPC URL (Helius/QuickNode). |
| `FC_MAX_BET` | *(optional)* max stake per bet in SOL (default 5). |
| `FC_AUTO_WITHDRAW_MAX` | *(optional)* auto-send ceiling in SOL; above this → review queue (default 2). |

Also add an **Upstash KV/Redis** store (Storage tab) — it injects
`KV_REST_API_URL` / `KV_REST_API_TOKEN`, which hold balances, accounts,
history, leaderboard, challenges and locks. All four pieces
(`TREASURY_SECRET`, `FC_MASTER_SEED`, `FC_SESSION_SECRET`, KV) must be present
for LIVE mode to switch on.

### Security model (what's already implemented)
- **Auth:** wallet-signature challenge/response → HMAC session token; every
  money path is `authed()` and `timingSafeEqual`-checked.
- **Concurrency:** per-user KV locks (`withLock`) guard bet / withdraw /
  deposit-check against double-spend / double-credit races.
- **Provably fair:** server seed committed as a hash up front; outcome =
  `HMAC-SHA256(serverSeed, clientSeed:nonce)`; rotate to reveal & verify.
- **House edge:** ~1% (GOAL/MISS ×1.98 at p=0.5; ZONE ×9.90 at p=0.10).

### Before you flip it on
- Fund the treasury with enough SOL for expected payouts **and** transaction
  fees (it pays fees for both deposit sweeps and withdrawals).
- Run a **drain a withdrawal worker** for the review queue (`fc:withdraw-queue`).
- Test end-to-end on **devnet** first (`SOLANA_RPC` → a devnet endpoint).
- Get a real audit before holding meaningful funds. This is a hot-wallet
  custodial system; treat the secrets accordingly and never commit them.

### Files
`lib/fc.js` (shared engine) · `api/fc-config|challenge|login|account|bet|`
`deposit-check|withdraw|profile|rotate-seed|leaderboard.js`.

### Legal note (again, louder)
Real-money "house pays winners" betting is **regulated gambling** in most
jurisdictions and degenfc-style games operate in a legal gray area. Confirm
this is acceptable for your audience/region before enabling LIVE mode. 18+.
