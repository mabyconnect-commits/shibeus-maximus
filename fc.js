/* ============================================================
   SHIBEUS FC — Degen Penalty Arena
   Phantom connect (real, read-only) · provably-fair penalty
   shootout · BETA arena-credit economy. On-chain SOL wagering
   is wired server-side at launch; see README / SETUP.md.
   ============================================================ */
(function () {
  "use strict";
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  if (!$("#stadium")) return;

  /* ---- Economics / odds ---------------------------------- */
  const RPC = "https://api.mainnet-beta.solana.com";
  const START_CREDITS = 5.0;       // free ◎ credits granted on connect
  const HOUSE_EDGE = 0.05;         // 5% — keeps the lights on
  const P_GOAL = 0.47;             // base chance a shot is a GOAL
  const MIN_BET = 0.01;

  const multFor = (p) => (1 - HOUSE_EDGE) / p;           // fair payout minus edge
  const MULT = { goal: multFor(P_GOAL), miss: multFor(1 - P_GOAL) };
  const PROB = { goal: P_GOAL, miss: 1 - P_GOAL };

  const fmt = (n, d = 3) => Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmt2 = (n) => fmt(n, 2);
  const short = (a) => a.slice(0, 4) + "…" + a.slice(-4);
  const clamp0 = (n) => Math.max(0, n);

  /* ---- State --------------------------------------------- */
  let provider = null;       // Phantom provider
  let address = null;        // connected pubkey (string)
  let side = "goal";         // selected bet side
  let aim = "center";        // selected aim
  let busy = false;          // a shot is in flight
  let state = null;          // { credits, shots, wins, streak, best, wagered, pnl, history, server, hash, client, nonce }

  /* ---- Elements ------------------------------------------ */
  const el = {
    connectCard: $("#connectCard"), connectBtn: $("#connectBtn"), connectMsg: $("#connectMsg"),
    walletCard: $("#walletCard"), walletAddr: $("#walletAddr"), disconnectBtn: $("#disconnectBtn"),
    solBal: $("#solBal"), creditBal: $("#creditBal"),
    sideGoal: $("#sideGoal"), sideMiss: $("#sideMiss"),
    goalPct: $("#goalPct"), missPct: $("#missPct"), goalMult: $("#goalMult"), missMult: $("#missMult"),
    oddsGoal: $("#oddsGoal"), oddsMiss: $("#oddsMiss"), globalShots: $("#globalShots"),
    betInput: $("#betInput"), totalBet: $("#totalBet"), toWin: $("#toWin"),
    kickBtn: $("#kickBtn"), betMsg: $("#betMsg"),
    stShots: $("#stShots"), stWinRate: $("#stWinRate"), stStreak: $("#stStreak"),
    stWagered: $("#stWagered"), stPnl: $("#stPnl"), stBest: $("#stBest"),
    feed: $("#feed"),
    keeper: $("#keeper"), ball: $("#ball"), flash: $("#flash"), flashText: $("#flashText"),
    seedToggle: $("#seedToggle"), seedDetail: $("#seedDetail"),
    seedHash: $("#seedHash"), clientSeed: $("#clientSeed"), nonce: $("#nonce"),
    rotateSeed: $("#rotateSeed"), revealMsg: $("#revealMsg"),
  };

  /* ============================================================
     PROVABLY FAIR (client-side for BETA)
     outcome float = HMAC-SHA256(serverSeed, clientSeed:nonce)
     ============================================================ */
  const enc = new TextEncoder();
  const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const randHex = (bytes = 16) => toHex(crypto.getRandomValues(new Uint8Array(bytes)));

  async function sha256Hex(str) {
    return toHex(await crypto.subtle.digest("SHA-256", enc.encode(str)));
  }
  async function hmacFloat(serverSeed, message) {
    const key = await crypto.subtle.importKey("raw", enc.encode(serverSeed), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
    const int = ((sig[0] << 24) | (sig[1] << 16) | (sig[2] << 8) | sig[3]) >>> 0;
    return int / 2 ** 32; // [0,1)
  }

  async function newSeedPair() {
    state.server = randHex(32);
    state.hash = await sha256Hex(state.server);
    if (!state.client) state.client = randHex(8);
    state.nonce = 0;
    renderFair();
  }

  function renderFair() {
    el.seedHash.textContent = state.hash || "—";
    el.clientSeed.textContent = state.client || "—";
    el.nonce.textContent = state.nonce;
  }

  /* ============================================================
     PERSISTENCE (per wallet, BETA — clearly labeled play money)
     ============================================================ */
  const key = (addr) => `shibeusfc:${addr}`;
  function load(addr) {
    try {
      const raw = localStorage.getItem(key(addr));
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return {
      credits: START_CREDITS, shots: 0, wins: 0, streak: 0, best: 0,
      wagered: 0, pnl: 0, history: [], server: "", hash: "", client: "", nonce: 0,
    };
  }
  const save = () => { if (address) localStorage.setItem(key(address), JSON.stringify(state)); };

  /* ============================================================
     WALLET (Phantom)
     ============================================================ */
  function getProvider() {
    if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
    if (window.solana?.isPhantom) return window.solana;
    return null;
  }

  async function connect(eager = false) {
    provider = getProvider();
    if (!provider) {
      el.connectMsg.textContent = "Phantom not found. ";
      el.connectMsg.className = "bet-msg err";
      const a = document.createElement("a");
      a.href = "https://phantom.app/"; a.target = "_blank"; a.rel = "noopener";
      a.className = "fair-link"; a.textContent = "Install Phantom ↗";
      el.connectMsg.appendChild(a);
      return;
    }
    try {
      el.connectMsg.textContent = "Opening Phantom…";
      el.connectMsg.className = "bet-msg";
      const resp = await provider.connect(eager ? { onlyIfTrusted: true } : {});
      address = resp.publicKey.toString();
      onConnected();
    } catch (e) {
      if (!eager) {
        el.connectMsg.textContent = "Connection cancelled.";
        el.connectMsg.className = "bet-msg err";
      }
    }
  }

  async function onConnected() {
    state = load(address);
    if (!state.server) await newSeedPair(); else renderFair();
    el.connectCard.hidden = true;
    el.walletCard.hidden = false;
    el.walletAddr.textContent = short(address);
    el.connectMsg.textContent = "";
    renderAll();
    fetchSol();
    provider.on && provider.on("disconnect", disconnect);
    provider.on && provider.on("accountChanged", (pk) => {
      if (pk) { address = pk.toString(); onConnected(); } else disconnect();
    });
  }

  function disconnect() {
    try { provider && provider.disconnect && provider.disconnect(); } catch (_) {}
    address = null; state = null;
    el.walletCard.hidden = true;
    el.connectCard.hidden = false;
    el.connectMsg.textContent = "";
    el.solBal.textContent = "—";
    el.creditBal.textContent = "0.000";
    el.feed.innerHTML = '<p class="feed-empty">No shots yet — step to the spot.</p>';
  }

  async function fetchSol() {
    if (!address) return;
    try {
      const r = await fetch(RPC, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address] }),
      });
      const d = await r.json();
      const sol = (d?.result?.value || 0) / 1e9;
      el.solBal.textContent = fmt(sol) + " ◎";
    } catch (_) {
      el.solBal.textContent = "n/a";
    }
  }

  /* ============================================================
     BET BUILDER
     ============================================================ */
  function selectSide(s) {
    side = s;
    el.sideGoal.classList.toggle("sel", s === "goal");
    el.sideMiss.classList.toggle("sel", s === "miss");
    renderReadout();
  }

  function selectAim(a) {
    aim = a;
    $$(".aim").forEach((b) => b.classList.toggle("sel", b.dataset.aim === a));
  }

  const betValue = () => Math.max(0, Number(el.betInput.value) || 0);

  function renderReadout() {
    const bet = betValue();
    el.totalBet.textContent = fmt(bet) + " ◎";
    el.toWin.textContent = fmt(bet * MULT[side]) + " ◎";
  }

  function renderOdds() {
    el.goalPct.textContent = Math.round(PROB.goal * 100) + "% chance";
    el.missPct.textContent = Math.round(PROB.miss * 100) + "% chance";
    el.goalMult.textContent = "×" + MULT.goal.toFixed(2);
    el.missMult.textContent = "×" + MULT.miss.toFixed(2);
    el.oddsGoal.textContent = Math.round(PROB.goal * 100) + "%";
    el.oddsMiss.textContent = Math.round(PROB.miss * 100) + "%";
  }

  function renderStats() {
    el.creditBal.textContent = fmt(state.credits);
    el.stShots.textContent = state.shots;
    el.stWinRate.textContent = state.shots ? Math.round((state.wins / state.shots) * 100) + "%" : "0%";
    el.stStreak.textContent = state.streak;
    el.stWagered.textContent = fmt2(state.wagered);
    el.stPnl.textContent = (state.pnl >= 0 ? "+" : "") + fmt2(state.pnl);
    el.stPnl.style.color = state.pnl > 0 ? "var(--goal-green)" : state.pnl < 0 ? "var(--miss-red)" : "var(--gold)";
    el.stBest.textContent = fmt2(state.best);
    el.globalShots.textContent = (1370 + state.shots).toLocaleString("en-US");
  }

  function renderFeed() {
    if (!state.history.length) {
      el.feed.innerHTML = '<p class="feed-empty">No shots yet — step to the spot.</p>';
      return;
    }
    el.feed.innerHTML = state.history.slice(0, 12).map((h) => `
      <div class="feed-row">
        <span><b style="font-family:var(--font-display)">${h.side.toUpperCase()}</b> · ${fmt2(h.bet)} ◎</span>
        <span class="tag ${h.win ? "win" : "loss"}">${h.outcome.toUpperCase()}</span>
        <span class="amt ${h.win ? "win" : "loss"}">${h.win ? "+" + fmt2(h.payout) : "-" + fmt2(h.bet)} ◎</span>
      </div>`).join("");
  }

  function renderAll() { renderOdds(); renderReadout(); renderStats(); renderFeed(); }

  /* ============================================================
     THE PENALTY
     ============================================================ */
  function resetScene() {
    el.ball.classList.remove("spin");
    el.ball.style.transition = "none";
    el.ball.style.transform = "translate(-50%, 0)";
    el.keeper.className = "keeper";
    el.flash.className = "scene-flash";
    // force reflow so the next transition runs
    void el.ball.offsetWidth;
  }

  function animateShot(outcome) {
    return new Promise((resolve) => {
      // where the ball ends up — aimed corner, lifted into the goal
      const lateral = aim === "left" ? -120 : aim === "right" ? 120 : 0;
      const lift = -300; // px upward into the goal mouth

      // keeper logic: on a MISS (save) the keeper guesses the aimed side;
      // on a GOAL the keeper dives the wrong way (or stays beaten).
      let keeperDir;
      if (outcome === "miss") keeperDir = aim;            // save: dives where you shot
      else keeperDir = aim === "center"
        ? (Math.random() < 0.5 ? "left" : "right")        // beaten down the middle
        : (aim === "left" ? "right" : "left");            // wrong-foots the keeper

      el.ball.classList.add("spin");
      requestAnimationFrame(() => {
        el.keeper.classList.add("dive-" + keeperDir);
        el.ball.style.transition = "transform 0.62s cubic-bezier(.22,.61,.36,1)";
        if (outcome === "miss") {
          // ball is stopped around the keeper's hands, drops down
          el.ball.style.transform = `translate(calc(-50% + ${lateral * 0.55}px), ${lift * 0.6}px) scale(0.85)`;
          setTimeout(() => {
            el.ball.style.transition = "transform 0.4s ease-in";
            el.ball.style.transform = `translate(calc(-50% + ${lateral * 0.3}px), -40px) scale(0.8)`;
          }, 640);
        } else {
          el.ball.style.transform = `translate(calc(-50% + ${lateral}px), ${lift}px) scale(0.72)`;
        }
      });

      setTimeout(resolve, outcome === "miss" ? 1080 : 720);
    });
  }

  function showFlash(outcome, win) {
    el.flashText.textContent = outcome === "goal"
      ? (win ? "GOAL! 🏆" : "GOAL…") : (win ? "SAVED! 🧤" : "MISS!");
    el.flash.className = "scene-flash show " + outcome;
  }

  async function takePenalty() {
    if (busy || !state) return;
    const bet = betValue();
    if (bet < MIN_BET) {
      flashMsg("Minimum bet is " + fmt2(MIN_BET) + " ◎.", "err"); return;
    }
    if (bet > state.credits + 1e-9) {
      flashMsg("Not enough arena credits. Use a smaller bet.", "err"); return;
    }

    busy = true;
    el.kickBtn.disabled = true;
    el.kickBtn.textContent = "Taking the shot…";
    el.betMsg.textContent = "";
    resetScene();

    // ---- provably-fair outcome (decided now, before animation) ----
    const message = `${state.client}:${state.nonce}`;
    const roll = await hmacFloat(state.server, message);
    const outcome = roll < PROB.goal ? "goal" : "miss";
    const win = outcome === side;
    const payout = win ? bet * MULT[side] : 0;
    state.nonce += 1;

    // ---- settle credits ----
    state.credits = clamp0(state.credits - bet + payout);
    state.shots += 1;
    state.wagered += bet;
    state.pnl += payout - bet;
    if (win) {
      state.wins += 1;
      state.streak = state.streak >= 0 ? state.streak + 1 : 1;
      if (payout - bet > state.best) state.best = payout - bet;
    } else {
      state.streak = state.streak <= 0 ? state.streak - 1 : -1;
    }
    state.history.unshift({ side, outcome, win, bet, payout, t: Date.now() });
    state.history = state.history.slice(0, 50);

    await animateShot(outcome);
    showFlash(outcome, win);
    renderStats();
    renderFeed();
    renderFair();
    save();

    flashMsg(
      win ? `${outcome === "goal" ? "GOAL" : "SAVED"} — you called it! +${fmt(payout - bet)} ◎`
          : `Wrong call — the ball went ${outcome === "goal" ? "in" : "wide/saved"}. −${fmt(bet)} ◎`,
      win ? "ok" : "err"
    );

    // top-up if they bust, so the demo always keeps going
    if (state.credits < MIN_BET) {
      setTimeout(() => {
        state.credits = START_CREDITS;
        save(); renderStats();
        flashMsg("Out of credits — the empire grants you a fresh " + fmt(START_CREDITS) + " ◎.", "ok");
      }, 1400);
    }

    setTimeout(() => {
      el.flash.className = "scene-flash";
      resetScene();
      busy = false;
      el.kickBtn.disabled = false;
      el.kickBtn.textContent = "⚽ Take the Penalty";
    }, 1800);
  }

  function flashMsg(text, cls) {
    el.betMsg.textContent = text;
    el.betMsg.className = "bet-msg " + (cls || "");
  }

  /* ============================================================
     WIRE UP
     ============================================================ */
  el.connectBtn.addEventListener("click", () => connect(false));
  el.disconnectBtn.addEventListener("click", disconnect);
  el.sideGoal.addEventListener("click", () => selectSide("goal"));
  el.sideMiss.addEventListener("click", () => selectSide("miss"));
  $$(".aim").forEach((b) => b.addEventListener("click", () => selectAim(b.dataset.aim)));
  el.kickBtn.addEventListener("click", takePenalty);
  el.betInput.addEventListener("input", renderReadout);

  $$(".chip").forEach((c) => c.addEventListener("click", () => {
    const cur = betValue();
    if (c.dataset.chip) el.betInput.value = c.dataset.chip;
    else if (c.dataset.op === "half") el.betInput.value = Math.max(MIN_BET, cur / 2).toFixed(2);
    else if (c.dataset.op === "double") el.betInput.value = (cur * 2).toFixed(2);
    else if (c.dataset.op === "max") el.betInput.value = state ? state.credits.toFixed(2) : cur.toFixed(2);
    renderReadout();
  }));

  el.seedToggle.addEventListener("click", () => {
    const hidden = el.seedDetail.hidden;
    el.seedDetail.hidden = !hidden;
    el.seedToggle.textContent = hidden ? "hide" : "show";
  });
  el.rotateSeed.addEventListener("click", async () => {
    if (!state) return;
    const old = state.server;
    await newSeedPair();
    save();
    el.revealMsg.innerHTML = `Previous server seed revealed: <code>${old}</code> — hash it (SHA-256) to confirm it matched. New round is now active.`;
    el.revealMsg.className = "bet-msg ok";
  });

  // keyboard: G/M to pick, space/enter to shoot
  document.addEventListener("keydown", (e) => {
    if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
    if (e.key === "g" || e.key === "G") selectSide("goal");
    else if (e.key === "m" || e.key === "M") selectSide("miss");
    else if ((e.key === " " || e.key === "Enter") && address) { e.preventDefault(); takePenalty(); }
  });

  // initial render + try eager (already-trusted) connect
  renderOdds();
  renderReadout();
  setTimeout(() => connect(true), 300);
})();
