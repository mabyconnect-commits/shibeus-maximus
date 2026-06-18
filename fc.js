/* ============================================================
   SHIBEUS FC — Degen Penalty Arena
   Phantom sign-in (read-only) · GOAL/MISS bet (×1.98) · optional
   ZONE corner bet (×9.90) · provably-fair engine · leaderboard ·
   custodial-style account (deposit/withdraw/profile).
   BETA economy on free arena credits; on-chain SOL at launch.
   ============================================================ */
(function () {
  "use strict";
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  if (!$("#stadium")) return;

  /* ---- Economics / odds ---------------------------------- */
  const RPC = "https://api.mainnet-beta.solana.com";
  const START_CREDITS = 5.0;
  const GRANT = 1.0;
  const MAIN_MULT = 1.98;     // GOAL / MISS payout
  const ZONE_MULT = 9.9;      // exact-corner payout
  const P_GOAL = 0.5;         // true goal probability (≈1% edge at ×1.98)
  const MIN_BET = 0.01;
  const ZONES_LAND = ["TL", "TR", "BL", "BR", "C"]; // 5 landing zones (≈1% edge at ×9.90)
  const ZONE_NAME = { TL: "TOP LEFT", TR: "TOP RIGHT", BL: "BOTTOM LEFT", BR: "BOTTOM RIGHT", C: "CENTER" };
  const ZONE_OFFSET = { TL: { x: -120, y: -310 }, TR: { x: 120, y: -310 }, BL: { x: -120, y: -190 }, BR: { x: 120, y: -190 }, C: { x: 0, y: -250 } };
  const ZONE_KEEPER = { TL: "left", TR: "right", BL: "left", BR: "right", C: "center" };

  const fmt = (n, d = 3) => Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmt2 = (n) => fmt(n, 2);
  const short = (a) => a.slice(0, 4) + "…" + a.slice(-4);
  const clamp0 = (n) => Math.max(0, n);

  /* ---- State --------------------------------------------- */
  let provider = null, address = null;
  let side = "goal", zoneOn = false, zonePick = null, busy = false;
  let state = null, lbMode = "profit";

  /* ---- Elements ------------------------------------------ */
  const el = {
    connectCard: $("#connectCard"), connectBtn: $("#connectBtn"), connectMsg: $("#connectMsg"),
    walletCard: $("#walletCard"), walletHandle: $("#walletHandle"), accountBtn: $("#accountBtn"), creditBal: $("#creditBal"),
    sideGoal: $("#sideGoal"), sideMiss: $("#sideMiss"),
    sentGoal: $("#sentGoal"), sentMiss: $("#sentMiss"),
    betInput: $("#betInput"), zoneInput: $("#zoneInput"),
    zonebet: $("#zonebet"), zbSwitch: $("#zbSwitch"), zbPick: $("#zbPick"), zones: $("#zones"),
    totalBet: $("#totalBet"), toWin: $("#toWin"),
    kickBtn: $("#kickBtn"), betMsg: $("#betMsg"),
    stShots: $("#stShots"), stWinRate: $("#stWinRate"), stStreak: $("#stStreak"),
    stWagered: $("#stWagered"), stPnl: $("#stPnl"), stBest: $("#stBest"),
    feed: $("#feed"),
    keeper: $("#keeper"), ball: $("#ball"), flash: $("#flash"), flashText: $("#flashText"), flashSub: $("#flashSub"),
    // modals
    howBtn: $("#howBtn"), lbBtn: $("#lbBtn"),
    obBack: $("#obBack"), accBack: $("#accBack"), lbBack: $("#lbBack"), proofBack: $("#proofBack"),
    accBal: $("#accBal"), accAddr: $("#accAddr"), handleInput: $("#handleInput"), saveHandle: $("#saveHandle"),
    profileMsg: $("#profileMsg"), logoutBtn: $("#logoutBtn"),
    grantBtn: $("#grantBtn"), depositMsg: $("#depositMsg"), qrSvg: $("#qrSvg"),
    wdDest: $("#wdDest"), wdAmount: $("#wdAmount"), wdBtn: $("#wdBtn"), withdrawMsg: $("#withdrawMsg"),
    lbProfit: $("#lbProfit"), lbWagered: $("#lbWagered"), lbCol: $("#lbCol"), lbBody: $("#lbBody"),
    proofBody: $("#proofBody"), rotateSeed: $("#rotateSeed"), revealMsg: $("#revealMsg"),
  };

  /* ============================================================
     PROVABLY FAIR
     ============================================================ */
  const enc = new TextEncoder();
  const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const randHex = (bytes = 16) => toHex(crypto.getRandomValues(new Uint8Array(bytes)));
  const sha256Hex = async (str) => toHex(await crypto.subtle.digest("SHA-256", enc.encode(str)));
  async function hmacFloat(serverSeed, message) {
    const key = await crypto.subtle.importKey("raw", enc.encode(serverSeed), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
    const int = ((sig[0] << 24) | (sig[1] << 16) | (sig[2] << 8) | sig[3]) >>> 0;
    return int / 2 ** 32;
  }
  async function newSeedPair() {
    state.server = randHex(32);
    state.hash = await sha256Hex(state.server);
    if (!state.client) state.client = randHex(8);
    state.nonce = 0;
  }

  /* ============================================================
     PERSISTENCE (per wallet, BETA play money)
     ============================================================ */
  const key = (addr) => `shibeusfc:${addr}`;
  function load(addr) {
    try { const raw = localStorage.getItem(key(addr)); if (raw) return JSON.parse(raw); } catch (_) {}
    return {
      credits: START_CREDITS, handle: "", shots: 0, wins: 0, streak: 0, best: 0,
      wagered: 0, pnl: 0, history: [], recent: [], revealed: [],
      server: "", hash: "", client: "", nonce: 0,
    };
  }
  const save = () => { if (address) localStorage.setItem(key(address), JSON.stringify(state)); };

  /* ============================================================
     WALLET
     ============================================================ */
  const getProvider = () =>
    (window.phantom?.solana?.isPhantom && window.phantom.solana) ||
    (window.solana?.isPhantom && window.solana) || null;

  async function connect(eager = false) {
    provider = getProvider();
    if (!provider) {
      el.connectMsg.innerHTML = 'Phantom not found. <a class="linkish" href="https://phantom.app/" target="_blank" rel="noopener">Install Phantom ↗</a>';
      el.connectMsg.className = "bet-msg err";
      return;
    }
    try {
      el.connectMsg.textContent = "Opening Phantom…"; el.connectMsg.className = "bet-msg";
      const resp = await provider.connect(eager ? { onlyIfTrusted: true } : {});
      address = resp.publicKey.toString();
      await onConnected();
    } catch (e) {
      if (!eager) { el.connectMsg.textContent = "Connection cancelled."; el.connectMsg.className = "bet-msg err"; }
    }
  }

  async function onConnected() {
    state = load(address);
    if (!state.server) await newSeedPair();
    el.connectCard.hidden = true;
    el.walletCard.hidden = false;
    el.connectMsg.textContent = "";
    el.accAddr.textContent = short(address);
    el.wdDest.value = short(address);
    el.handleInput.value = state.handle || "";
    renderAll();
    save();
    provider.on && provider.on("disconnect", logout);
    provider.on && provider.on("accountChanged", (pk) => { if (pk) { address = pk.toString(); onConnected(); } else logout(); });
    if (!localStorage.getItem("shibeusfc:onboarded")) openModal("obBack");
  }

  function logout() {
    try { provider && provider.disconnect && provider.disconnect(); } catch (_) {}
    address = null; state = null;
    closeAll();
    el.walletCard.hidden = true; el.connectCard.hidden = false;
    el.connectMsg.textContent = ""; el.creditBal.textContent = "0.000";
    el.feed.innerHTML = '<p class="feed-empty">No shots yet — step to the spot.</p>';
  }

  /* ============================================================
     BET BUILDER
     ============================================================ */
  function selectSide(s) {
    side = s;
    el.sideGoal.classList.toggle("sel", s === "goal");
    el.sideMiss.classList.toggle("sel", s === "miss");
    // ZONE bet only valid on GOAL
    el.zonebet.classList.toggle("disabled", s !== "goal");
    if (s !== "goal" && zoneOn) toggleZone(false);
    renderReadout();
  }

  function toggleZone(force) {
    if (side !== "goal") { zoneOn = false; }
    else zoneOn = force !== undefined ? force : !zoneOn;
    el.zbSwitch.classList.toggle("on", zoneOn);
    el.zonebet.classList.toggle("open", zoneOn);
    el.zones.classList.toggle("on", zoneOn);
    renderReadout();
  }

  function selectZone(z) {
    if (!ZONE_OFFSET[z] || z === "C") return; // corners only are bettable
    zonePick = z;
    $$(".zone").forEach((b) => b.classList.toggle("sel", b.dataset.zone === z));
    el.zbPick.textContent = ZONE_NAME[z];
    if (!zoneOn) toggleZone(true);
    renderReadout();
  }

  const betValue = () => Math.max(0, Number(el.betInput.value) || 0);
  const zoneValue = () => (zoneOn ? Math.max(0, Number(el.zoneInput.value) || 0) : 0);

  function renderReadout() {
    const main = betValue(), z = zoneValue();
    el.totalBet.textContent = fmt(main + z) + " ◎";
    const win = main * MAIN_MULT + (zoneOn && zonePick ? z * ZONE_MULT : 0);
    el.toWin.textContent = fmt(win) + " ◎";
  }

  function renderSentiment() {
    const r = state ? state.recent : [];
    const goals = r.filter((x) => x === "goal").length;
    const pct = r.length >= 4 ? Math.round((goals / r.length) * 100) : 45;
    el.sentGoal.style.width = pct + "%";
    el.sentGoal.textContent = "GOAL " + pct + "%";
    el.sentMiss.textContent = "MISS " + (100 - pct) + "%";
  }

  function renderStats() {
    el.creditBal.textContent = fmt(state.credits);
    el.accBal.textContent = fmt(state.credits);
    el.walletHandle.textContent = state.handle || short(address);
    el.stShots.textContent = state.shots;
    el.stWinRate.textContent = state.shots ? Math.round((state.wins / state.shots) * 100) + "%" : "0%";
    el.stStreak.textContent = state.streak;
    el.stWagered.textContent = fmt2(state.wagered);
    el.stPnl.textContent = (state.pnl >= 0 ? "+" : "") + fmt2(state.pnl);
    el.stPnl.style.color = state.pnl > 0 ? "var(--goal-green)" : state.pnl < 0 ? "var(--miss-red)" : "var(--gold)";
    el.stBest.textContent = fmt2(state.best);
  }

  function renderFeed() {
    if (!state.history.length) { el.feed.innerHTML = '<p class="feed-empty">No shots yet — step to the spot.</p>'; return; }
    el.feed.innerHTML = state.history.slice(0, 14).map((h, i) => {
      const res = (h.outcome === "goal" ? "GOAL" : "SAVE") + " → " + (ZONE_NAME[h.land] || h.land);
      return `<div class="feed-row">
        <span class="res"><span class="tag ${h.win ? "win" : "loss"}">${h.win ? "WIN" : "LOSS"}</span> ${res}</span>
        <span class="amt ${h.win ? "win" : "loss"}">${h.net >= 0 ? "+" : ""}${fmt2(h.net)}</span>
        <span class="proof" data-proof="${i}">proof</span>
      </div>`;
    }).join("");
    $$("[data-proof]", el.feed).forEach((p) => p.addEventListener("click", () => openProof(Number(p.dataset.proof))));
  }

  function renderAll() { renderReadout(); renderSentiment(); renderStats(); renderFeed(); }

  /* ============================================================
     THE PENALTY
     ============================================================ */
  function resetScene() {
    el.ball.classList.remove("spin");
    el.ball.style.transition = "none";
    el.ball.style.transform = "translate(-50%, 0)";
    el.keeper.className = "keeper";
    el.flash.className = "scene-flash";
    void el.ball.offsetWidth;
  }

  function animateShot(outcome, land) {
    return new Promise((resolve) => {
      const off = ZONE_OFFSET[land] || ZONE_OFFSET.C;
      let keeperDir;
      if (outcome === "miss") keeperDir = ZONE_KEEPER[land];           // save: dive to the ball
      else keeperDir = land === "C" ? (Math.random() < 0.5 ? "left" : "right")
        : (ZONE_KEEPER[land] === "left" ? "right" : "left");          // beaten the other way

      el.ball.classList.add("spin");
      requestAnimationFrame(() => {
        el.keeper.classList.add("dive-" + keeperDir);
        el.ball.style.transition = "transform 0.62s cubic-bezier(.22,.61,.36,1)";
        if (outcome === "miss") {
          el.ball.style.transform = `translate(calc(-50% + ${off.x * 0.55}px), ${off.y * 0.55}px) scale(0.85)`;
          setTimeout(() => {
            el.ball.style.transition = "transform 0.4s ease-in";
            el.ball.style.transform = `translate(calc(-50% + ${off.x * 0.3}px), -40px) scale(0.8)`;
          }, 640);
        } else {
          el.ball.style.transform = `translate(calc(-50% + ${off.x}px), ${off.y}px) scale(0.72)`;
        }
      });
      setTimeout(resolve, outcome === "miss" ? 1080 : 720);
    });
  }

  function showFlash(outcome, win, jackpot) {
    el.flash.className = "scene-flash show " + (jackpot ? "goal jackpot" : outcome);
    el.flashText.textContent = jackpot ? "TOP CORNER! 🎯"
      : outcome === "goal" ? (win ? "GOAL! 🏆" : "GOAL…")
      : (win ? "SAVED! 🧤" : "MISS!");
    el.flashSub.textContent = jackpot ? "ZONE bet smashed ×9.90" : "";
  }

  async function takePenalty() {
    if (busy || !state) return;
    const main = betValue();
    const z = zoneValue();
    const total = main + z;
    if (main < MIN_BET) return flashMsg("Minimum stake is " + fmt2(MIN_BET) + " ◎.", "err");
    if (zoneOn && (!zonePick || z < MIN_BET)) return flashMsg("Pick a corner and a ZONE stake (or turn ZONE off).", "err");
    if (total > state.credits + 1e-9) return flashMsg("Not enough credits. Lower your stake or claim more in Account → Deposit.", "err");

    busy = true; el.kickBtn.disabled = true; el.kickBtn.textContent = "Striking…"; el.betMsg.textContent = "";
    resetScene();

    // ---- provably-fair outcome (committed now) ----
    const msg = `${state.client}:${state.nonce}`;
    const roll = await hmacFloat(state.server, msg);
    const zoneRoll = await hmacFloat(state.server, msg + ":zone");
    const outcome = roll < P_GOAL ? "goal" : "miss";
    const land = outcome === "goal" ? ZONES_LAND[Math.floor(zoneRoll * ZONES_LAND.length)] : ZONE_KEEPER_TO_LAND(zoneRoll);

    const mainWin = side === outcome;
    const mainProfit = mainWin ? main * (MAIN_MULT - 1) : -main;
    const zoneActive = zoneOn && zonePick && z >= MIN_BET;
    const zoneWin = zoneActive && outcome === "goal" && land === zonePick;
    const zoneProfit = zoneActive ? (zoneWin ? z * (ZONE_MULT - 1) : -z) : 0;
    const net = mainProfit + zoneProfit;

    // ---- settle ----
    state.credits = clamp0(state.credits + net);
    state.shots += 1;
    state.wagered += total;
    state.pnl += net;
    const win = net > 0;
    if (win) { state.wins += 1; state.streak = state.streak >= 0 ? state.streak + 1 : 1; if (net > state.best) state.best = net; }
    else { state.streak = state.streak <= 0 ? state.streak - 1 : -1; }
    state.recent.unshift(outcome); state.recent = state.recent.slice(0, 20);
    state.history.unshift({
      side, zone: zoneActive ? zonePick : null, outcome, land, win, net,
      main, z: zoneActive ? z : 0, t: Date.now(),
      hash: state.hash, client: state.client, nonce: state.nonce, seed: state.server, roll, zoneRoll,
    });
    state.history = state.history.slice(0, 60);
    state.nonce += 1;

    await animateShot(outcome, land);
    showFlash(outcome, win, zoneWin);
    renderAll(); save();

    flashMsg(
      win ? (zoneWin ? `JACKPOT corner! +${fmt(net)} ◎` : `You called it — +${fmt(net)} ◎`)
          : `Wrong call — ${fmt(net)} ◎`,
      win ? "ok" : "err"
    );

    if (state.credits < MIN_BET) setTimeout(() => {
      state.credits = GRANT; save(); renderStats();
      flashMsg("Out of credits — the empire grants you " + fmt(GRANT) + " ◎. Take the spot.", "ok");
    }, 1400);

    setTimeout(() => {
      el.flash.className = "scene-flash"; resetScene();
      busy = false; el.kickBtn.disabled = false; el.kickBtn.textContent = "⚽ Take the Penalty";
    }, 1800);
  }

  // for a saved shot, pick where the keeper sent it (for the "SAVE → X" label)
  function ZONE_KEEPER_TO_LAND(r) {
    const opts = ["TL", "TR", "BL", "BR", "C"];
    return opts[Math.floor(r * opts.length)];
  }

  const flashMsg = (text, cls) => { el.betMsg.textContent = text; el.betMsg.className = "bet-msg " + (cls || ""); };

  /* ============================================================
     MODALS
     ============================================================ */
  function openModal(id) { $("#" + id).classList.add("open"); }
  function closeModal(id) { $("#" + id).classList.remove("open"); }
  function closeAll() { $$(".modal-back").forEach((m) => m.classList.remove("open")); }
  $$("[data-close]").forEach((b) => b.addEventListener("click", () => closeModal(b.dataset.close)));
  $$(".modal-back").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) m.classList.remove("open"); }));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });

  /* onboarding */
  function obGo(i) {
    $$(".ob-slide").forEach((s) => s.classList.toggle("on", Number(s.dataset.slide) === i));
    $$(".ob-dots i").forEach((d, di) => d.classList.toggle("on", di === i));
  }
  $("#obNext").addEventListener("click", () => obGo(1));
  $("#obNext2").addEventListener("click", () => obGo(2));
  $("#obDone").addEventListener("click", () => { localStorage.setItem("shibeusfc:onboarded", "1"); closeModal("obBack"); });
  el.howBtn.addEventListener("click", () => { obGo(0); openModal("obBack"); });

  /* account */
  el.accountBtn.addEventListener("click", () => { el.accBal.textContent = fmt(state.credits); openModal("accBack"); });
  $$(".tab").forEach((t) => t.addEventListener("click", () => {
    $$(".tab").forEach((x) => x.classList.toggle("on", x === t));
    $$(".tabpane").forEach((p) => p.classList.toggle("on", p.id === "pane" + t.dataset.tab));
  }));
  el.saveHandle.addEventListener("click", () => {
    const h = el.handleInput.value.trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(h)) { el.profileMsg.textContent = "Handle must be 3–20 letters, numbers or _."; el.profileMsg.className = "bet-msg err"; return; }
    state.handle = h; save(); renderStats();
    el.profileMsg.textContent = "Saved! You'll show as " + h + " on the board."; el.profileMsg.className = "bet-msg ok";
  });
  el.logoutBtn.addEventListener("click", logout);
  el.grantBtn.addEventListener("click", () => {
    state.credits += GRANT; save(); renderStats();
    el.depositMsg.textContent = "+" + fmt(GRANT) + " ◎ demo credits added. Go score."; el.depositMsg.className = "bet-msg ok";
  });
  el.wdBtn.addEventListener("click", () => {
    el.withdrawMsg.innerHTML = "🏛️ Withdrawals activate at launch. Your balance of <b>" + fmt(state.credits) + " ◎</b> is recorded to " + short(address) + ".";
    el.withdrawMsg.className = "bet-msg";
  });

  /* leaderboard */
  const SEED = [
    { h: "PenaltyKing", shots: 9, profit: 0.874, wag: 3.1 },
    { h: "VoltStriker", shots: 10, profit: 0.841, wag: 4.2 },
    { h: "GoldenBoots", shots: 19, profit: 0.421, wag: 6.0 },
    { h: "ColdFinish", shots: 8, profit: 0.38, wag: 2.0 },
    { h: "Zhio", shots: 22, profit: 0.238, wag: 7.4 },
    { h: "SpotKicker", shots: 14, profit: 0.227, wag: 3.7 },
    { h: "KeeperKiller", shots: 5, profit: 0.099, wag: 1.1 },
    { h: "NetRipper", shots: 7, profit: 0.014, wag: 2.2 },
    { h: "PanenkaPro", shots: 11, profit: -0.553, wag: 5.0 },
    { h: "LastSecond", shots: 9, profit: -0.464, wag: 2.8 },
    { h: "GolazoGuru", shots: 6, profit: -0.476, wag: 1.9 },
  ];
  function renderLeaderboard() {
    const me = state ? { h: state.handle || "You", shots: state.shots, profit: state.pnl, wag: state.wagered, me: true } : null;
    const rows = SEED.slice();
    if (me && me.shots > 0) rows.push(me);
    rows.sort((a, b) => lbMode === "profit" ? b.profit - a.profit : b.wag - a.wag);
    const medals = ["🥇", "🥈", "🥉"];
    el.lbCol.textContent = lbMode === "profit" ? "Profit" : "Wagered";
    el.lbBody.innerHTML = rows.slice(0, 12).map((r, i) => {
      const val = lbMode === "profit"
        ? `<td class="${r.profit >= 0 ? "pos" : "neg"}">${r.profit >= 0 ? "+" : ""}${fmt(r.profit)} ◎</td>`
        : `<td class="pos">${fmt2(r.wag)} ◎</td>`;
      return `<tr class="${r.me ? "me" : ""}"><td class="rank">${i < 3 ? `<span class="medal">${medals[i]}</span>` : i + 1}</td>
        <td class="pname">${r.h}${r.me ? " (you)" : ""}</td><td>${r.shots}</td>${val}</tr>`;
    }).join("");
  }
  el.lbBtn.addEventListener("click", () => { renderLeaderboard(); openModal("lbBack"); });
  el.lbProfit.addEventListener("click", () => { lbMode = "profit"; el.lbProfit.classList.add("on"); el.lbWagered.classList.remove("on"); renderLeaderboard(); });
  el.lbWagered.addEventListener("click", () => { lbMode = "wagered"; el.lbWagered.classList.add("on"); el.lbProfit.classList.remove("on"); renderLeaderboard(); });

  /* proof */
  function openProof(i) {
    const h = state.history[i]; if (!h) return;
    const revealed = state.revealed.includes(h.hash);
    const rows = [
      ["Bet", `${h.side.toUpperCase()}${h.zone ? " + ZONE " + ZONE_NAME[h.zone] : ""}`],
      ["Result", `${h.outcome === "goal" ? "GOAL" : "SAVE"} → ${ZONE_NAME[h.land]}`],
      ["Net", `${h.net >= 0 ? "+" : ""}${fmt(h.net)} ◎`],
      ["Server seed (hash)", `<code>${h.hash}</code>`],
      ["Client seed", `<code>${h.client}</code>`],
      ["Nonce", `<code>${h.nonce}</code>`],
      ["Outcome roll", `<code>${h.roll.toFixed(8)}</code> ${h.roll < P_GOAL ? "&lt; 0.5 → GOAL" : "≥ 0.5 → MISS"}`],
      ["Corner roll", `<code>${h.zoneRoll.toFixed(8)}</code>`],
      ["Server seed", revealed ? `<code>${h.seed}</code>` : `<code>•••• (rotate seed to reveal)</code>`],
    ];
    el.proofBody.innerHTML = rows.map(([k, v]) => `<div class="proof-row"><span>${k}</span><span>${v}</span></div>`).join("");
    el.revealMsg.textContent = "";
    openModal("proofBack");
  }
  el.rotateSeed.addEventListener("click", async () => {
    if (!state) return;
    const old = state.server, oldHash = state.hash;
    if (!state.revealed.includes(oldHash)) state.revealed.push(oldHash);
    await newSeedPair(); save();
    el.revealMsg.innerHTML = `Revealed server seed: <code>${old}</code> — SHA-256 it to match the committed hash. New round active; reopen any past shot to verify.`;
    el.revealMsg.className = "bet-msg ok";
  });

  /* decorative (non-scannable) QR behind the launch lock */
  (function drawQR() {
    if (!el.qrSvg) return;
    let s = "";
    for (let y = 0; y < 29; y++) for (let x = 0; x < 29; x++)
      if ((x * 7 + y * 13 + ((x ^ y) * 5)) % 3 === 0) s += `<rect x="${x}" y="${y}" width="1" height="1" fill="#000"/>`;
    // finder squares
    const finder = (ox, oy) => `<rect x="${ox}" y="${oy}" width="7" height="7" fill="#000"/><rect x="${ox + 1}" y="${oy + 1}" width="5" height="5" fill="#fff"/><rect x="${ox + 2}" y="${oy + 2}" width="3" height="3" fill="#000"/>`;
    el.qrSvg.innerHTML = s + finder(0, 0) + finder(22, 0) + finder(0, 22);
  })();

  /* ============================================================
     WIRE UP
     ============================================================ */
  el.connectBtn.addEventListener("click", () => connect(false));
  el.sideGoal.addEventListener("click", () => selectSide("goal"));
  el.sideMiss.addEventListener("click", () => selectSide("miss"));
  el.zbSwitch.addEventListener("click", () => toggleZone());
  $$(".zone").forEach((b) => b.addEventListener("click", () => selectZone(b.dataset.zone)));
  el.kickBtn.addEventListener("click", takePenalty);
  el.betInput.addEventListener("input", renderReadout);
  el.zoneInput.addEventListener("input", renderReadout);

  $$(".chip").forEach((c) => c.addEventListener("click", () => {
    const cur = betValue();
    if (c.dataset.chip) el.betInput.value = c.dataset.chip;
    else if (c.dataset.op === "half") el.betInput.value = Math.max(MIN_BET, cur / 2).toFixed(2);
    else if (c.dataset.op === "double") el.betInput.value = (cur * 2).toFixed(2);
    else if (c.dataset.op === "max") el.betInput.value = state ? state.credits.toFixed(2) : cur.toFixed(2);
    renderReadout();
  }));

  document.addEventListener("keydown", (e) => {
    if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
    if (e.key === "g" || e.key === "G") selectSide("goal");
    else if (e.key === "m" || e.key === "M") selectSide("miss");
    else if ((e.key === " " || e.key === "Enter") && address && !$(".modal-back.open")) { e.preventDefault(); takePenalty(); }
  });

  renderReadout();
  renderSentiment();
  setTimeout(() => connect(true), 300);
})();
