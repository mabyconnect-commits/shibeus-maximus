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
