/* ============================================================
   SHIBEUS MAXIMUS — The Arena (holder gate, trivia-to-earn, raffle)
   Frontend game. On-chain claims/raffle payouts handled by /api/*.
   ============================================================ */
(function () {
  "use strict";
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  if (!$("#arena")) return;

  /* ---- Economics (matches the spec) ---- */
  const ROUND_SECONDS = 300; // 5-minute rounds
  const POOL_POINTS = 10000; // points available per round
  const POINTS_PER_CORRECT = 200; // earned per correct answer
  const POINTS_PER_TOKEN = 10; // 1,000 pts = 100 $SHIBEUS
  const MIN_HOLD = 50000;
  const RAFFLE_COST = 1000;

  const fmt = (n) => Number(n).toLocaleString("en-US");
  const tokensFor = (pts) => Math.floor(pts / POINTS_PER_TOKEN);

  /* ---- Persistent per-address state (BETA: client-side) ---- */
  let player = null; // { address, balance }
  const pointsKey = (addr) => `shibeus:points:${addr}`;
  const getPoints = (addr) => Number(localStorage.getItem(pointsKey(addr)) || 0);
  const setPoints = (addr, v) => localStorage.setItem(pointsKey(addr), String(Math.max(0, Math.floor(v))));

  /* ---- Round helpers (wall-clock synced so all players share a round) ---- */
  const now = () => Math.floor(Date.now() / 1000);
  const roundIndex = () => Math.floor(now() / ROUND_SECONDS);
  const roundEndsIn = () => ROUND_SECONDS - (now() % ROUND_SECONDS);
  // pool depletion is simulated locally in BETA, keyed by round
  const poolKey = () => `shibeus:pool:${roundIndex()}`;
  const getPool = () => {
    const v = localStorage.getItem(poolKey());
    return v === null ? POOL_POINTS : Number(v);
  };
  const setPool = (v) => localStorage.setItem(poolKey(), String(Math.max(0, v)));

  /* ============================================================
     TRIVIA BANK
     ============================================================ */
  const BANK = [
    { q: "What is the rallying cry of the Shiba Army?", o: ["Veni. Vidi. HODL.", "Buy high, sell low", "Trust me bro", "Wen lambo"], a: 0 },
    { q: "Which blockchain was Shibeus Maximus forged on?", o: ["Ethereum", "Solana", "Bitcoin", "Dogechain"], a: 1 },
    { q: "In meme lore, every dip is a…", o: ["Reason to panic", "Battlefield", "Bug", "Refund"], a: 1 },
    { q: "A green candle, to the legion, represents a…", o: ["Conquest", "Loss", "Tax", "Bridge"], a: 0 },
    { q: "What does 'HODL' famously stand for in spirit?", o: ["Hold On for Dear Life", "Hand OverDed Loot", "Hyper Optimized Daily Ledger", "Hot Or Dull Liquidity"], a: 0 },
    { q: "Shibeus rose from an ordinary Shiba into the supreme…", o: ["Validator", "Emperor of the blockchain", "Market maker", "Airdrop"], a: 1 },
    { q: "How many $SHIBEUS do you need to enter the Arena?", o: ["5,000", "50,000", "500,000", "5,000,000"], a: 1 },
    { q: "What is the native token of Solana?", o: ["ETH", "SOL", "BNB", "ADA"], a: 1 },
    { q: "A wallet's secret key should be…", o: ["Shared with admins", "Posted in chat", "Never shared", "Sold"], a: 2 },
    { q: "The Roman general's laurel wreath symbolizes…", o: ["Victory", "Defeat", "Debt", "Staking"], a: 0 },
    { q: "What does 'CA' stand for in a token launch?", o: ["Cash Advance", "Contract Address", "Coin Auction", "Central Authority"], a: 1 },
    { q: "DexScreener is used to…", o: ["Mint NFTs", "Track price & charts", "Stake SOL", "Bridge tokens"], a: 1 },
    { q: "Every holder in the Shiba Army is a…", o: ["Warrior", "Bystander", "Bear", "Whale only"], a: 0 },
    { q: "What kind of token is $SHIBEUS?", o: ["A stablecoin", "A meme coin", "A bond", "A CBDC"], a: 1 },
    { q: "Which gladiatorial venue is most associated with Rome?", o: ["The Colosseum", "The Louvre", "The Parthenon", "Big Ben"], a: 0 },
    { q: "A pump.fun token address typically ends in…", o: ["'.eth'", "'pump'", "'.sol'", "'dao'"], a: 1 },
    { q: "What's the safest way to verify holdings here?", o: ["Connect & approve spend", "Read-only address check", "Send tokens to admin", "Share seed phrase"], a: 1 },
    { q: "'Ave $SHIBEUS' is best translated as…", o: ["Goodbye Shibeus", "Hail Shibeus", "Sell Shibeus", "Sorry Shibeus"], a: 1 },
    { q: "The emperor leads which loyal force?", o: ["The Bear Brigade", "The Shiba Army", "The Paper Hands", "The Jeet Squad"], a: 1 },
    { q: "Doing your own research is known as…", o: ["FOMO", "DYOR", "FUD", "APR"], a: 1 },
  ];
  let qOrder = [];
  let qPos = 0;
  const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((p) => p[1]);
  const nextQuestion = () => {
    if (qPos >= qOrder.length) { qOrder = shuffle([...Array(BANK.length).keys()]); qPos = 0; }
    return BANK[qOrder[qPos++]];
  };

  /* ============================================================
     ELEMENTS
     ============================================================ */
  const gate = $("#arenaGate"), game = $("#arenaGame");
  const gateAddress = $("#gateAddress"), gateBtn = $("#gateBtn"), gateStatus = $("#gateStatus");
  const playerAddr = $("#playerAddr"), playerBal = $("#playerBal"), playerPoints = $("#playerPoints"), playerClaim = $("#playerClaim");
  const poolLeft = $("#poolLeft"), poolBar = $("#poolBar"), roundTimer = $("#roundTimer");
  const quizQ = $("#quizQ"), quizOpts = $("#quizOpts"), quizFeedback = $("#quizFeedback");
  const raffleTimer = $("#raffleTimer"), raffleBtn = $("#raffleBtn"), raffleWinners = $("#raffleWinners");
  const claimBtn = $("#claimBtn"), claimAmt = $("#claimAmt"), claimStatus = $("#claimStatus");

  /* ============================================================
     HOLDER GATE  (real, read-only — no wallet connect)
     ============================================================ */
  const short = (a) => a.slice(0, 4) + "…" + a.slice(-4);

  async function verify(address) {
    gateStatus.textContent = "Scanning the blockchain…";
    gateStatus.className = "gate-status";
    try {
      const r = await fetch("/api/verify-holder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Verification failed");
      return data; // {eligible, balance}
    } catch (e) {
      // If the API isn't reachable (e.g. local file open), fail clearly.
      throw e;
    }
  }

  async function enterArena() {
    const address = gateAddress.value.trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      gateStatus.textContent = "That doesn't look like a Solana address.";
      gateStatus.className = "gate-status err";
      return;
    }
    gateBtn.disabled = true;
    try {
      const res = await verify(address);
      if (!res.eligible) {
        gateStatus.innerHTML = `Holds <b>${fmt(Math.floor(res.balance))}</b> $SHIBEUS — need <b>${fmt(MIN_HOLD)}</b> to enter. Stack up, soldier.`;
        gateStatus.className = "gate-status err";
        gateBtn.disabled = false;
        return;
      }
      player = { address, balance: res.balance };
      localStorage.setItem("shibeus:player", JSON.stringify(player));
      startGame();
    } catch (e) {
      gateStatus.textContent = "Couldn't reach the verifier. Try again in a moment.";
      gateStatus.className = "gate-status err";
      gateBtn.disabled = false;
    }
  }

  /* ============================================================
     GAME
     ============================================================ */
  function refreshStats() {
    const pts = getPoints(player.address);
    playerPoints.textContent = fmt(pts);
    const tok = tokensFor(pts);
    playerClaim.textContent = fmt(tok) + " $SHIBEUS";
    claimAmt.textContent = fmt(tok);
    claimBtn.disabled = tok <= 0;
  }

  function refreshPool() {
    const left = getPool();
    poolLeft.textContent = fmt(left);
    poolBar.style.width = (left / POOL_POINTS) * 100 + "%";
    return left;
  }

  function renderQuestion() {
    const left = refreshPool();
    if (left <= 0) {
      quizQ.textContent = "Round pool drained! ⚔ The next wave begins shortly.";
      quizOpts.innerHTML = "";
      quizFeedback.textContent = "";
      return;
    }
    const item = nextQuestion();
    game._answer = item.a;
    game._locked = false;
    quizQ.textContent = item.q;
    quizFeedback.textContent = "";
    quizFeedback.className = "quiz-feedback";
    quizOpts.innerHTML = "";
    item.o.forEach((opt, i) => {
      const b = document.createElement("button");
      b.className = "quiz-opt";
      b.textContent = opt;
      b.addEventListener("click", () => answer(i, b));
      quizOpts.appendChild(b);
    });
  }

  function answer(i, btn) {
    if (game._locked) return;
    game._locked = true;
    const correct = i === game._answer;
    $$(".quiz-opt", quizOpts).forEach((b, idx) => {
      if (idx === game._answer) b.classList.add("correct");
      else if (idx === i) b.classList.add("wrong");
      b.disabled = true;
    });
    if (correct) {
      const pool = getPool();
      const award = Math.min(POINTS_PER_CORRECT, pool);
      setPool(pool - award);
      setPoints(player.address, getPoints(player.address) + award);
      quizFeedback.textContent = `+${fmt(award)} points for the empire! 🏛️`;
      quizFeedback.className = "quiz-feedback ok";
      refreshStats();
      refreshPool();
    } else {
      quizFeedback.textContent = "Ambushed! No points. Hold the line and try the next.";
      quizFeedback.className = "quiz-feedback err";
    }
    setTimeout(renderQuestion, 1300);
  }

  /* ---- Timers ---- */
  const pad = (n) => String(n).padStart(2, "0");
  let lastRound = roundIndex();
  function tick() {
    const rs = roundEndsIn();
    roundTimer.textContent = pad(Math.floor(rs / 60)) + ":" + pad(rs % 60);
    if (roundIndex() !== lastRound) { lastRound = roundIndex(); refreshPool(); renderQuestion(); }

    // raffle: countdown to top of the hour
    const d = new Date();
    const secsToHour = 3600 - (d.getMinutes() * 60 + d.getSeconds());
    raffleTimer.textContent = pad(Math.floor(secsToHour / 60)) + ":" + pad(secsToHour % 60);
  }

  /* ---- Raffle ---- */
  async function loadWinners() {
    try {
      const r = await fetch("/api/raffle-winners");
      if (!r.ok) return;
      const list = await r.json();
      if (Array.isArray(list) && list.length) {
        raffleWinners.innerHTML = list.slice(0, 5).map(
          (w) => `<li>👑 ${short(w.winner)} won <b>${fmt(w.amount || 0)}</b> $SHIBEUS</li>`
        ).join("");
      }
    } catch (_) {}
  }

  function enterRaffle() {
    raffleBtn.disabled = true;
    claimStatus.textContent = "";
    // Beta: entry requires sending tokens to the raffle wallet (announced at launch).
    alert(
      "🏆 Hourly Raffle — BETA\n\n" +
      `Entry costs ${fmt(RAFFLE_COST)} $SHIBEUS into the pot. One random warrior wins the entire pot every hour.\n\n` +
      "On-chain entries open at launch: you'll send $SHIBEUS to the official raffle wallet (announced in Telegram), and your address is entered automatically.\n\n" +
      "No wallet connect, ever."
    );
    raffleBtn.disabled = false;
  }

  /* ---- Claim ---- */
  async function claim() {
    const pts = getPoints(player.address);
    const tok = tokensFor(pts);
    if (tok <= 0) return;
    claimBtn.disabled = true;
    claimStatus.textContent = "Submitting to the treasury…";
    claimStatus.className = "claim-status";
    try {
      const r = await fetch("/api/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: player.address }),
      });
      const data = await r.json();
      if (data.ok) {
        setPoints(player.address, 0);
        refreshStats();
        claimStatus.innerHTML = `Sent <b>${fmt(data.tokens)}</b> $SHIBEUS! <a href="https://solscan.io/tx/${data.signature}" target="_blank" rel="noopener">View tx ↗</a>`;
        claimStatus.className = "claim-status ok";
      } else if (data.reason === "not_configured") {
        claimStatus.innerHTML = `⚠ Claims open at launch. Your <b>${fmt(pts)}</b> points are locked to <b>${short(player.address)}</b> and will be honored.`;
        claimStatus.className = "claim-status";
        claimBtn.disabled = false;
      } else {
        claimStatus.textContent = "Claim unavailable right now — try again shortly.";
        claimStatus.className = "claim-status err";
        claimBtn.disabled = false;
      }
    } catch (e) {
      claimStatus.innerHTML = `⚠ Claims open at launch. Your <b>${fmt(pts)}</b> points are saved to <b>${short(player.address)}</b>.`;
      claimStatus.className = "claim-status";
      claimBtn.disabled = false;
    }
  }

  /* ---- Boot ---- */
  function startGame() {
    gate.hidden = true;
    game.hidden = false;
    playerAddr.textContent = short(player.address);
    playerBal.textContent = fmt(Math.floor(player.balance)) + " $SHIBEUS";
    refreshStats();
    renderQuestion();
    loadWinners();
    if (!game._timer) game._timer = setInterval(tick, 1000);
    tick();
    game.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function logout() {
    localStorage.removeItem("shibeus:player");
    player = null;
    game.hidden = true;
    gate.hidden = false;
    gateBtn.disabled = false;
    gateAddress.value = "";
    gateStatus.textContent = "";
  }

  /* ---- Wire up ---- */
  gateBtn.addEventListener("click", enterArena);
  gateAddress.addEventListener("keydown", (e) => { if (e.key === "Enter") enterArena(); });
  raffleBtn.addEventListener("click", enterRaffle);
  claimBtn.addEventListener("click", claim);
  $("#logoutBtn").addEventListener("click", logout);

  // resume session
  const saved = localStorage.getItem("shibeus:player");
  if (saved) {
    try { player = JSON.parse(saved); if (player && player.address) startGame(); } catch (_) {}
  }
})();
