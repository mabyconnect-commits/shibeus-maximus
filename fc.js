/* ============================================================
   SHIBEUS FC — Degen Penalty Arena (client)
   Two modes, auto-detected via /api/fc-config:
     • LIVE  — real custodial SOL play. Sign-in-with-wallet session,
               server-authoritative provably-fair bets, on-chain
               deposit/withdraw. (Backend in api/fc-*.js + lib/fc.js)
     • BETA  — free arena credits, client-side provably-fair engine.
   The UI is identical; only the source of truth changes.
   ============================================================ */
(function () {
  "use strict";
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  if (!$("#stadium")) return;

  /* ---- Economics / odds (mirrors lib/fc.js) -------------- */
  const START_CREDITS = 5.0, GRANT = 1.0;
  const MAIN_MULT = 1.98, ZONE_MULT = 9.9, P_GOAL = 0.5, MIN_BET = 0.01;
  const ZONES_LAND = ["TL", "TR", "BL", "BR", "C"];
  const ZONE_NAME = { TL: "TOP LEFT", TR: "TOP RIGHT", BL: "BOTTOM LEFT", BR: "BOTTOM RIGHT", C: "CENTER" };
  const ZONE_OFFSET = { TL: { x: -120, y: -310 }, TR: { x: 120, y: -310 }, BL: { x: -120, y: -190 }, BR: { x: 120, y: -190 }, C: { x: 0, y: -250 } };
  const ZONE_KEEPER = { TL: "left", TR: "right", BL: "left", BR: "right", C: "center" };

  const fmt = (n, d = 3) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmt2 = (n) => fmt(n, 2);
  const short = (a) => a.slice(0, 4) + "…" + a.slice(-4);
  const clamp0 = (n) => Math.max(0, n);

  /* ---- State --------------------------------------------- */
  let provider = null, address = null;
  let side = "goal", zoneOn = false, zonePick = null, busy = false;
  let state = null, lbMode = "profit";

  /* ---- Elements ------------------------------------------ */
  const el = {};
  ["connectCard","connectBtn","connectMsg","walletCard","walletHandle","accountBtn","creditBal","modePill",
   "sideGoal","sideMiss","sentGoal","sentMiss","betInput","zoneInput","zonebet","zbSwitch","zbPick","zones",
   "totalBet","toWin","kickBtn","betMsg","stShots","stWinRate","stStreak","stWagered","stPnl","stBest","feed",
   "keeper","ball","flash","flashText","flashSub","howBtn","lbBtn","obBack","accBack","lbBack","proofBack",
   "accBal","accAddr","handleInput","saveHandle","profileMsg","logoutBtn","grantBtn","depositMsg","qrSvg","qrLive",
   "depLive","depBeta","depAddr","copyDep","checkDepBtn","wdDest","wdAmount","wdBtn","wdNote","withdrawMsg",
   "lbProfit","lbWagered","lbCol","lbBody","proofBody","rotateSeed","revealMsg"
  ].forEach((id) => (el[id] = $("#" + id)));

  /* ============================================================
     base58 (for encoding the wallet signature on sign-in)
     ============================================================ */
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function b58encode(bytes) {
    const digits = [0];
    for (let i = 0; i < bytes.length; i++) {
      let carry = bytes[i];
      for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
      while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
    }
    let str = "";
    for (let k = 0; k < bytes.length && bytes[k] === 0; k++) str += "1";
    for (let q = digits.length - 1; q >= 0; q--) str += B58[digits[q]];
    return str;
  }

  /* ============================================================
     BACKEND — live custodial API (auto-falls back to BETA)
     ============================================================ */
  const API = {
    live: false, token: null, deposit: null,
    async detect() {
      try { const r = await fetch("/api/fc-config"); const d = await r.json(); this.live = !!d.configured; }
      catch (_) { this.live = false; }
      return this.live;
    },
    async post(path, extra) {
      const r = await fetch(path, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, token: this.token, ...extra }),
      });
      return r.json();
    },
    async login() {
      // 1) get a single-use challenge, 2) sign the exact server message,
      // 3) exchange the signature for a session token.
      const c = await this.post("/api/fc-challenge", {});
      if (!c.ok) throw new Error(c.error || "challenge_failed");
      const signed = await provider.signMessage(new TextEncoder().encode(c.message), "utf8");
      const sigBytes = signed.signature || signed; // Phantom returns { signature }
      const signature = b58encode(sigBytes);
      const d = await this.post("/api/fc-login", { nonce: c.nonce, signature });
      if (!d.ok) throw new Error(d.error || "login_failed");
      this.token = d.token; this.deposit = d.account.depositAddress;
      return d.account;
    },
  };

  /* ============================================================
     PROVABLY FAIR (BETA / client-side)
     ============================================================ */
  const enc = new TextEncoder();
  const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const randHex = (bytes = 16) => toHex(crypto.getRandomValues(new Uint8Array(bytes)));
  const sha256Hex = async (str) => toHex(await crypto.subtle.digest("SHA-256", enc.encode(str)));
  async function hmacFloat(serverSeed, message) {
    const key = await crypto.subtle.importKey("raw", enc.encode(serverSeed), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
    return (((sig[0] << 24) | (sig[1] << 16) | (sig[2] << 8) | sig[3]) >>> 0) / 2 ** 32;
  }
  async function newSeedPair() {
    state.server = randHex(32);
    state.hash = await sha256Hex(state.server);
    if (!state.client) state.client = randHex(8);
    state.nonce = 0;
  }

  /* ============================================================
     LOCAL PERSISTENCE (BETA play money)
     ============================================================ */
  const key = (addr) => `shibeusfc:${addr}`;
  function blank() {
    return {
      credits: START_CREDITS, handle: "", shots: 0, wins: 0, streak: 0, best: 0,
      wagered: 0, pnl: 0, history: [], recent: [], revealedSeeds: {},
      server: "", hash: "", client: "", nonce: 0,
    };
  }
  function load(addr) {
    try { const raw = localStorage.getItem(key(addr)); if (raw) return Object.assign(blank(), JSON.parse(raw)); } catch (_) {}
    return blank();
  }
  const save = () => { if (address && !API.live) localStorage.setItem(key(address), JSON.stringify(state)); };

  /* server account snapshot -> local state shape */
  function applyAccount(acc) {
    state.credits = acc.balance; state.handle = acc.handle || "";
    state.shots = acc.shots; state.wins = acc.wins; state.streak = acc.streak;
    state.best = acc.best; state.wagered = acc.wagered; state.pnl = acc.pnl;
    state.hash = acc.serverSeedHash; state.client = acc.clientSeed; state.nonce = acc.nonce;
  }

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
      el.connectMsg.className = "bet-msg err"; return;
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
    await API.detect();
    state = blank();
    if (API.live) {
      el.connectMsg.textContent = "Sign in your wallet to play with SOL…";
      try {
        const acc = await API.login();
        applyAccount(acc);
      } catch (e) {
        // user rejected the signature (or login failed) → graceful BETA
        API.live = false;
        state = load(address);
        if (!state.server) await newSeedPair();
        el.connectMsg.textContent = "Skipped sign-in — playing free BETA credits.";
      }
    } else {
      state = load(address);
      if (!state.server) await newSeedPair();
    }
    setMode();
    el.connectCard.hidden = true;
    el.walletCard.hidden = false;
    el.accAddr.textContent = short(address);
    el.wdDest.value = address;
    el.handleInput.value = state.handle || "";
    renderAll();
    save();
    provider.on && provider.on("disconnect", logout);
    provider.on && provider.on("accountChanged", (pk) => { if (pk) { address = pk.toString(); onConnected(); } else logout(); });
    if (!localStorage.getItem("shibeusfc:onboarded")) openModal("obBack");
  }

  function setMode() {
    el.modePill.textContent = API.live ? "LIVE · SOL" : "BETA credits";
    el.modePill.className = "mode-pill " + (API.live ? "live" : "beta");
    // deposit pane: live shows the real address; beta shows the lock + grant
    el.depLive.hidden = !API.live;
    el.depBeta.hidden = API.live;
    if (API.live && API.deposit) { el.depAddr.textContent = API.deposit; drawQR(el.qrLive, API.deposit); }
    el.wdNote.textContent = API.live
      ? "Sends real SOL from the treasury to your wallet. Amounts over the auto limit go to a manual review queue; failed sends are refunded."
      : "Withdrawals send real SOL at launch. Large amounts go to a manual review queue; failed sends are refunded automatically.";
  }

  function logout() {
    try { provider && provider.disconnect && provider.disconnect(); } catch (_) {}
    address = null; state = null; API.token = null; API.deposit = null;
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
    el.zonebet.classList.toggle("disabled", s !== "goal");
    if (s !== "goal" && zoneOn) toggleZone(false);
    renderReadout();
  }
  function toggleZone(force) {
    zoneOn = side !== "goal" ? false : force !== undefined ? force : !zoneOn;
    el.zbSwitch.classList.toggle("on", zoneOn);
    el.zonebet.classList.toggle("open", zoneOn);
    el.zones.classList.toggle("on", zoneOn);
    renderReadout();
  }
  function selectZone(z) {
    if (!ZONE_OFFSET[z] || z === "C") return;
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
    el.toWin.textContent = fmt(main * MAIN_MULT + (zoneOn && zonePick ? z * ZONE_MULT : 0)) + " ◎";
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
      if (outcome === "miss") keeperDir = ZONE_KEEPER[land];
      else keeperDir = land === "C" ? (Math.random() < 0.5 ? "left" : "right") : (ZONE_KEEPER[land] === "left" ? "right" : "left");
      el.ball.classList.add("spin");
      requestAnimationFrame(() => {
        el.keeper.classList.add("dive-" + keeperDir);
        el.ball.style.transition = "transform 0.62s cubic-bezier(.22,.61,.36,1)";
        if (outcome === "miss") {
          el.ball.style.transform = `translate(calc(-50% + ${off.x * 0.55}px), ${off.y * 0.55}px) scale(0.85)`;
          setTimeout(() => { el.ball.style.transition = "transform 0.4s ease-in"; el.ball.style.transform = `translate(calc(-50% + ${off.x * 0.3}px), -40px) scale(0.8)`; }, 640);
        } else {
          el.ball.style.transform = `translate(calc(-50% + ${off.x}px), ${off.y}px) scale(0.72)`;
        }
      });
      setTimeout(resolve, outcome === "miss" ? 1080 : 720);
    });
  }
  function showFlash(outcome, win, jackpot) {
    el.flash.className = "scene-flash show " + (jackpot ? "goal jackpot" : outcome);
    el.flashText.textContent = jackpot ? "TOP CORNER! 🎯" : outcome === "goal" ? (win ? "GOAL! 🏆" : "GOAL…") : (win ? "SAVED! 🧤" : "MISS!");
    el.flashSub.textContent = jackpot ? "ZONE bet smashed ×9.90" : "";
  }

  // BETA settlement (client-side provably fair)
  async function settleLocal(p) {
    const msg = `${state.client}:${state.nonce}`;
    const roll = await hmacFloat(state.server, msg);
    const zoneRoll = await hmacFloat(state.server, msg + ":zone");
    const outcome = roll < P_GOAL ? "goal" : "miss";
    const land = ZONES_LAND[Math.floor(zoneRoll * ZONES_LAND.length)];
    const mainProfit = p.side === outcome ? p.main * (MAIN_MULT - 1) : -p.main;
    const zoneActive = p.zoneOn && p.zonePick && p.z >= MIN_BET;
    const zoneWin = zoneActive && outcome === "goal" && land === p.zonePick;
    const zoneProfit = zoneActive ? (zoneWin ? p.z * (ZONE_MULT - 1) : -p.z) : 0;
    const net = Math.round((mainProfit + zoneProfit) * 1e9) / 1e9;
    const win = net > 0;

    state.credits = clamp0(state.credits + net);
    state.shots += 1; state.wagered += p.main + p.z; state.pnl += net;
    if (win) { state.wins += 1; state.streak = state.streak >= 0 ? state.streak + 1 : 1; if (net > state.best) state.best = net; }
    else { state.streak = state.streak <= 0 ? state.streak - 1 : -1; }
    const record = { side: p.side, zone: zoneActive ? p.zonePick : null, outcome, land, win, net, main: p.main, z: zoneActive ? p.z : 0, hash: state.hash, client: state.client, nonce: state.nonce, roll, zoneRoll, t: Date.now() };
    if (!state.revealedSeeds) state.revealedSeeds = {};
    record._seed = state.server; // kept locally so a later rotate can reveal it
    state.history.unshift(record); state.history = state.history.slice(0, 60);
    state.recent.unshift(outcome); state.recent = state.recent.slice(0, 20);
    state.nonce += 1;
    return { ok: true, outcome, land, net, win, zoneWin };
  }

  // LIVE settlement (server-authoritative)
  async function settleServer(p) {
    const d = await API.post("/api/fc-bet", { side: p.side, stake: p.main, zone: p.zoneOn ? p.zonePick : null, zoneStake: p.zoneOn ? p.z : 0 });
    if (!d.ok) return { ok: false, error: d.error };
    const r = d.record;
    state.history.unshift({ ...r, land: d.land, outcome: d.outcome }); state.history = state.history.slice(0, 60);
    state.recent.unshift(d.outcome); state.recent = state.recent.slice(0, 20);
    applyAccount(d.account);
    return { ok: true, outcome: d.outcome, land: d.land, net: d.net, win: d.win, zoneWin: d.zoneWin };
  }

  async function takePenalty() {
    if (busy || !state) return;
    const main = betValue(), z = zoneValue(), total = main + z;
    if (main < MIN_BET) return flashMsg("Minimum stake is " + fmt2(MIN_BET) + " ◎.", "err");
    if (zoneOn && (!zonePick || z < MIN_BET)) return flashMsg("Pick a corner and a ZONE stake (or turn ZONE off).", "err");
    if (total > state.credits + 1e-9) return flashMsg("Not enough balance. Lower the stake or top up in Account → Deposit.", "err");

    busy = true; el.kickBtn.disabled = true; el.kickBtn.textContent = "Striking…"; el.betMsg.textContent = "";
    resetScene();

    const p = { side, main, z, zoneOn, zonePick };
    let r;
    try { r = API.live ? await settleServer(p) : await settleLocal(p); }
    catch (e) { r = { ok: false, error: "network" }; }

    if (!r.ok) {
      busy = false; el.kickBtn.disabled = false; el.kickBtn.textContent = "⚽ Take the Penalty";
      return flashMsg(r.error === "insufficient" ? "Not enough balance for that stake." : "Couldn't place the bet — try again.", "err");
    }

    await animateShot(r.outcome, r.land);
    showFlash(r.outcome, r.win, r.zoneWin);
    renderAll(); save();
    flashMsg(r.win ? (r.zoneWin ? `JACKPOT corner! +${fmt(r.net)} ◎` : `You called it — +${fmt(r.net)} ◎`) : `Wrong call — ${fmt(r.net)} ◎`, r.win ? "ok" : "err");

    if (!API.live && state.credits < MIN_BET) setTimeout(() => {
      state.credits = GRANT; save(); renderStats();
      flashMsg("Out of credits — the empire grants you " + fmt(GRANT) + " ◎. Take the spot.", "ok");
    }, 1400);

    setTimeout(() => { el.flash.className = "scene-flash"; resetScene(); busy = false; el.kickBtn.disabled = false; el.kickBtn.textContent = "⚽ Take the Penalty"; }, 1800);
  }

  const flashMsg = (text, cls) => { el.betMsg.textContent = text; el.betMsg.className = "bet-msg " + (cls || ""); };

  /* ============================================================
     MODALS
     ============================================================ */
  const openModal = (id) => $("#" + id).classList.add("open");
  const closeModal = (id) => $("#" + id).classList.remove("open");
  const closeAll = () => $$(".modal-back").forEach((m) => m.classList.remove("open"));
  $$("[data-close]").forEach((b) => b.addEventListener("click", () => closeModal(b.dataset.close)));
  $$(".modal-back").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) m.classList.remove("open"); }));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });

  /* onboarding */
  const obGo = (i) => { $$(".ob-slide").forEach((s) => s.classList.toggle("on", Number(s.dataset.slide) === i)); $$(".ob-dots i").forEach((d, di) => d.classList.toggle("on", di === i)); };
  $("#obNext").addEventListener("click", () => obGo(1));
  $("#obNext2").addEventListener("click", () => obGo(2));
  $("#obDone").addEventListener("click", () => { localStorage.setItem("shibeusfc:onboarded", "1"); closeModal("obBack"); });
  el.howBtn.addEventListener("click", () => { obGo(0); openModal("obBack"); });

  /* account */
  el.accountBtn.addEventListener("click", () => { el.accBal.textContent = fmt(state.credits); openModal("accBack"); });
  $$(".tab").forEach((t) => t.addEventListener("click", () => {
    $$(".tab").forEach((x) => x.classList.toggle("on", x === t));
    $$(".tabpane").forEach((pp) => pp.classList.toggle("on", pp.id === "pane" + t.dataset.tab));
  }));
  el.saveHandle.addEventListener("click", async () => {
    const h = el.handleInput.value.trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(h)) return setMsg(el.profileMsg, "Handle must be 3–20 letters, numbers or _.", "err");
    if (API.live) {
      const d = await API.post("/api/fc-profile", { handle: h });
      if (!d.ok) return setMsg(el.profileMsg, "Couldn't save handle.", "err");
      applyAccount(d.account);
    } else { state.handle = h; save(); }
    renderStats();
    setMsg(el.profileMsg, "Saved! You'll show as " + h + " on the board.", "ok");
  });
  el.logoutBtn.addEventListener("click", logout);

  el.grantBtn.addEventListener("click", () => {
    state.credits += GRANT; save(); renderStats();
    setMsg(el.depositMsg, "+" + fmt(GRANT) + " ◎ demo credits added. Go score.", "ok");
  });
  el.copyDep && el.copyDep.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(API.deposit || ""); setMsg(el.depositMsg, "Address copied.", "ok"); }
    catch (_) { setMsg(el.depositMsg, "Copy failed — select the address manually.", "err"); }
  });
  el.checkDepBtn && el.checkDepBtn.addEventListener("click", async () => {
    setMsg(el.depositMsg, "Scanning the chain for your deposit…", "");
    const d = await API.post("/api/fc-deposit-check", {});
    if (!d.ok) return setMsg(el.depositMsg, "Couldn't check right now — try again.", "err");
    if (d.credited > 0) { state.credits = d.balance; renderStats(); setMsg(el.depositMsg, `Credited ${fmt(d.credited)} ◎! New balance ${fmt(d.balance)} ◎.`, "ok"); }
    else setMsg(el.depositMsg, "No new deposit found yet. Send SOL to the address above, then check again.", "");
  });

  el.wdBtn.addEventListener("click", async () => {
    if (!API.live) return setMsg(el.withdrawMsg, "🏛️ Withdrawals activate at launch. Balance of " + fmt(state.credits) + " ◎ is recorded to " + short(address) + ".", "");
    const amount = Number(el.wdAmount.value), dest = el.wdDest.value.trim();
    setMsg(el.withdrawMsg, "Submitting withdrawal…", "");
    const d = await API.post("/api/fc-withdraw", { destination: dest, amount });
    if (!d.ok) return setMsg(el.withdrawMsg, d.error === "below_min" ? "Below the minimum withdrawal." : d.error === "insufficient" ? "Not enough balance." : "Withdrawal failed.", "err");
    state.credits = d.balance; renderStats();
    if (d.queued) setMsg(el.withdrawMsg, `Queued ${fmt(amount)} ◎ for manual review — large withdrawals are checked before sending.`, "ok");
    else setMsg(el.withdrawMsg, `Sent ${fmt(amount)} ◎! ` + (d.signature ? `View on Solscan ↗` : ""), "ok");
    if (d.signature) { el.withdrawMsg.innerHTML += ` <a class="linkish" href="https://solscan.io/tx/${d.signature}" target="_blank" rel="noopener">tx ↗</a>`; }
  });

  /* leaderboard */
  const SEED = [
    { h: "PenaltyKing", shots: 9, profit: 0.874, wag: 3.1 }, { h: "VoltStriker", shots: 10, profit: 0.841, wag: 4.2 },
    { h: "GoldenBoots", shots: 19, profit: 0.421, wag: 6.0 }, { h: "ColdFinish", shots: 8, profit: 0.38, wag: 2.0 },
    { h: "Zhio", shots: 22, profit: 0.238, wag: 7.4 }, { h: "SpotKicker", shots: 14, profit: 0.227, wag: 3.7 },
    { h: "KeeperKiller", shots: 5, profit: 0.099, wag: 1.1 }, { h: "NetRipper", shots: 7, profit: 0.014, wag: 2.2 },
    { h: "PanenkaPro", shots: 11, profit: -0.553, wag: 5.0 }, { h: "LastSecond", shots: 9, profit: -0.464, wag: 2.8 },
    { h: "GolazoGuru", shots: 6, profit: -0.476, wag: 1.9 },
  ];
  function drawLB(rows) {
    rows.sort((a, b) => (lbMode === "profit" ? b.profit - a.profit : b.wag - a.wag));
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
  async function renderLeaderboard() {
    if (API.live) {
      try {
        const d = await (await fetch("/api/fc-leaderboard?mode=" + lbMode)).json();
        if (d.ok && d.rows && d.rows.length) {
          return drawLB(d.rows.map((r) => ({ ...r, me: state && (r.h === (state.handle || short(address))) })));
        }
      } catch (_) {}
    }
    const rows = SEED.slice();
    if (state && state.shots > 0) rows.push({ h: state.handle || "You", shots: state.shots, profit: state.pnl, wag: state.wagered, me: true });
    drawLB(rows);
  }
  el.lbBtn.addEventListener("click", () => { renderLeaderboard(); openModal("lbBack"); });
  el.lbProfit.addEventListener("click", () => { lbMode = "profit"; el.lbProfit.classList.add("on"); el.lbWagered.classList.remove("on"); renderLeaderboard(); });
  el.lbWagered.addEventListener("click", () => { lbMode = "wagered"; el.lbWagered.classList.add("on"); el.lbProfit.classList.remove("on"); renderLeaderboard(); });

  /* proof */
  function openProof(i) {
    const h = state.history[i]; if (!h) return;
    const seed = (state.revealedSeeds && state.revealedSeeds[h.hash]) || null;
    const rows = [
      ["Bet", `${h.side.toUpperCase()}${h.zone ? " + ZONE " + ZONE_NAME[h.zone] : ""}`],
      ["Result", `${h.outcome === "goal" ? "GOAL" : "SAVE"} → ${ZONE_NAME[h.land] || h.land}`],
      ["Net", `${h.net >= 0 ? "+" : ""}${fmt(h.net)} ◎`],
      ["Server seed (hash)", `<code>${h.hash}</code>`],
      ["Client seed", `<code>${h.client}</code>`],
      ["Nonce", `<code>${h.nonce}</code>`],
      ["Outcome roll", `<code>${(h.roll ?? 0).toFixed(8)}</code> ${(h.roll ?? 1) < P_GOAL ? "&lt; 0.5 → GOAL" : "≥ 0.5 → MISS"}`],
      ["Corner roll", `<code>${(h.zoneRoll ?? 0).toFixed(8)}</code>`],
      ["Server seed", seed ? `<code>${seed}</code>` : `<code>•••• (rotate seed to reveal)</code>`],
    ];
    el.proofBody.innerHTML = rows.map(([k, v]) => `<div class="proof-row"><span>${k}</span><span>${v}</span></div>`).join("");
    el.revealMsg.textContent = "";
    openModal("proofBack");
  }
  el.rotateSeed.addEventListener("click", async () => {
    if (!state) return;
    if (!state.revealedSeeds) state.revealedSeeds = {};
    if (API.live) {
      const d = await API.post("/api/fc-rotate-seed", {});
      if (!d.ok) return setMsg(el.revealMsg, "Couldn't rotate right now.", "err");
      state.revealedSeeds[d.revealed.serverSeedHash] = d.revealed.serverSeed;
      state.hash = d.next.serverSeedHash; state.client = d.next.clientSeed; state.nonce = d.next.nonce;
      setMsg(el.revealMsg, "Revealed server seed for the retired round — SHA-256 it to match the hash. New round active.", "ok");
    } else {
      const old = state.server, oldHash = state.hash;
      state.revealedSeeds[oldHash] = old;
      await newSeedPair(); save();
      el.revealMsg.innerHTML = `Revealed server seed: <code>${old}</code> — SHA-256 it to match the committed hash. New round active.`;
      el.revealMsg.className = "bet-msg ok";
    }
  });

  const setMsg = (node, text, cls) => { node.textContent = text; node.className = "bet-msg " + (cls || ""); };

  /* decorative / real QR (module fill) */
  function drawQR(svg, seedStr) {
    if (!svg) return;
    // Deterministic module pattern from the string (visual only — pair with the
    // copy button for the real address; not a scannable spec implementation).
    let hsh = 2166136261;
    const str = seedStr || "shibeus";
    for (let i = 0; i < str.length; i++) { hsh ^= str.charCodeAt(i); hsh = Math.imul(hsh, 16777619); }
    let s = "", rnd = hsh >>> 0;
    const next = () => (rnd = (Math.imul(rnd, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    for (let y = 0; y < 29; y++) for (let x = 0; x < 29; x++) if (next() > 0.5) s += `<rect x="${x}" y="${y}" width="1" height="1" fill="#000"/>`;
    const finder = (ox, oy) => `<rect x="${ox}" y="${oy}" width="7" height="7" fill="#000"/><rect x="${ox + 1}" y="${oy + 1}" width="5" height="5" fill="#fff"/><rect x="${ox + 2}" y="${oy + 2}" width="3" height="3" fill="#000"/>`;
    svg.innerHTML = s + finder(0, 0) + finder(22, 0) + finder(0, 22);
  }
  drawQR(el.qrSvg, "shibeus-beta");

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
