/* ============================================================
   SHIBEUS MAXIMUS — interactions
   ============================================================ */
(function () {
  "use strict";

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];

  const CONTRACT = "SHIBEUS000ComingSoon000VeniVidiHODL000Maximus";

  /* ---- Year ---- */
  const yr = $("#year");
  if (yr) yr.textContent = new Date().getFullYear();

  /* ---- Nav scroll state + floating coin ---- */
  const nav = $("#nav");
  const floatCoin = $(".float-coin");
  const onScroll = () => {
    const y = window.scrollY;
    nav.classList.toggle("scrolled", y > 40);
    if (floatCoin) floatCoin.classList.toggle("show", y > 700);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---- Mobile menu ---- */
  const burger = $("#burger");
  const links = $(".nav__links");
  if (burger) {
    burger.addEventListener("click", () => links.classList.toggle("open"));
    $$(".nav__links a").forEach((a) =>
      a.addEventListener("click", () => links.classList.remove("open"))
    );
  }

  /* ---- Reveal on scroll ---- */
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  $$(".reveal").forEach((el, i) => {
    el.style.transitionDelay = `${(i % 4) * 70}ms`;
    io.observe(el);
  });

  /* ---- Copy contract ---- */
  function copyContract(btn, resetLabel) {
    navigator.clipboard.writeText(CONTRACT).then(() => {
      const original = btn.textContent;
      btn.textContent = "Copied! ✓";
      setTimeout(() => (btn.textContent = resetLabel || original), 1600);
    });
  }
  const ca1 = $("#copyCa");
  const caText = $("#caText");
  if (ca1) ca1.addEventListener("click", (e) => { e.preventDefault(); copyContract(caText, "Copy Contract"); });
  const ca2 = $("#copyCa2");
  if (ca2) ca2.addEventListener("click", () => copyContract(ca2, "Copy"));

  /* ---- Stat counters ---- */
  const animateStat = (el, target, suffix) => {
    let n = 0;
    const dur = 1400, start = performance.now();
    const step = (t) => {
      const p = Math.min((t - start) / dur, 1);
      n = Math.floor(p * target);
      el.textContent = n + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const s2 = $("#s2"), s3 = $("#s3");
  const statIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        if (e.target === s2) animateStat(s2, 0, "%");
        if (e.target === s3) animateStat(s3, 100, "%");
        statIO.unobserve(e.target);
      }
    });
  }, { threshold: 0.6 });
  [s2, s3].forEach((s) => s && statIO.observe(s));

  /* ============================================================
     LIGHTBOX
     ============================================================ */
  const tiles = $$(".tile");
  const lb = $("#lightbox");
  const lbImg = $("#lbImg");
  const lbCap = $("#lbCap");
  let lbIndex = 0;

  const gallery = tiles.map((t) => ({
    full: t.dataset.full,
    cap: $("figcaption", t)?.textContent || "",
  }));

  function openLb(i) {
    lbIndex = (i + gallery.length) % gallery.length;
    lbImg.src = gallery[lbIndex].full;
    lbCap.textContent = gallery[lbIndex].cap;
    lb.classList.add("open");
    lb.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
  function closeLb() {
    lb.classList.remove("open");
    lb.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }
  tiles.forEach((t, i) => t.addEventListener("click", () => openLb(i)));
  $("#lbClose")?.addEventListener("click", closeLb);
  $("#lbPrev")?.addEventListener("click", () => openLb(lbIndex - 1));
  $("#lbNext")?.addEventListener("click", () => openLb(lbIndex + 1));
  lb?.addEventListener("click", (e) => { if (e.target === lb) closeLb(); });
  document.addEventListener("keydown", (e) => {
    if (!lb.classList.contains("open")) return;
    if (e.key === "Escape") closeLb();
    if (e.key === "ArrowRight") openLb(lbIndex + 1);
    if (e.key === "ArrowLeft") openLb(lbIndex - 1);
  });

  /* ============================================================
     MEME GENERATOR
     ============================================================ */
  const canvas = $("#memeCanvas");
  if (canvas) {
    const ctx = canvas.getContext("2d");
    const W = (canvas.width = 1200);
    const H = (canvas.height = 675); // 16:9 — ideal X post

    const topInput = $("#memeTop");
    const bottomInput = $("#memeBottom");
    const userInput = $("#memeUser");
    const bgButtons = $$(".bg-pick");
    const logo = new Image();
    logo.src = "assets/shibeus.png";

    let bgImg = new Image();
    let bgSrc = bgButtons[0]?.dataset.src || "assets/gallery/01-throne-dark.jpg";
    let logoReady = false, bgReady = false;

    logo.onload = () => { logoReady = true; draw(); };

    function loadBg(src) {
      bgReady = false;
      bgImg = new Image();
      bgImg.onload = () => { bgReady = true; draw(); };
      bgImg.src = src;
      bgSrc = src;
    }

    // Cover-fit draw
    function drawCover(img) {
      const ir = img.width / img.height;
      const cr = W / H;
      let dw, dh, dx, dy;
      if (ir > cr) { dh = H; dw = H * ir; dx = (W - dw) / 2; dy = 0; }
      else { dw = W; dh = W / ir; dx = 0; dy = (H - dh) / 2; }
      ctx.drawImage(img, dx, dy, dw, dh);
    }

    function outlinedText(text, x, y, size) {
      ctx.font = `900 ${size}px Cinzel, Impact, sans-serif`;
      ctx.textAlign = "center";
      ctx.lineJoin = "round";
      ctx.lineWidth = size * 0.16;
      ctx.strokeStyle = "rgba(8,6,2,0.92)";
      ctx.strokeText(text, x, y);
      const grad = ctx.createLinearGradient(0, y - size, 0, y + size * 0.2);
      grad.addColorStop(0, "#fff4d6");
      grad.addColorStop(0.5, "#f0cd7a");
      grad.addColorStop(1, "#c79a3e");
      ctx.fillStyle = grad;
      ctx.fillText(text, x, y);
    }

    // Wrap to max 2 lines
    function fitLines(text, max) {
      const words = text.toUpperCase().split(/\s+/).filter(Boolean);
      const lines = [];
      let line = "";
      ctx.font = "900 60px Cinzel, Impact, sans-serif";
      words.forEach((w) => {
        const test = line ? line + " " + w : w;
        if (ctx.measureText(test).width > max && line) { lines.push(line); line = w; }
        else line = test;
      });
      if (line) lines.push(line);
      return lines.slice(0, 2);
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);

      // background
      if (bgReady) drawCover(bgImg);
      else { ctx.fillStyle = "#12100a"; ctx.fillRect(0, 0, W, H); }

      // subtle vignette for text legibility
      const vg = ctx.createLinearGradient(0, 0, 0, H);
      vg.addColorStop(0, "rgba(8,6,2,0.55)");
      vg.addColorStop(0.35, "rgba(8,6,2,0.0)");
      vg.addColorStop(0.7, "rgba(8,6,2,0.0)");
      vg.addColorStop(1, "rgba(8,6,2,0.75)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);

      // gold border frame
      ctx.strokeStyle = "rgba(232,192,105,0.85)";
      ctx.lineWidth = 8;
      ctx.strokeRect(14, 14, W - 28, H - 28);

      // top text
      const top = (topInput.value || "").trim();
      if (top) {
        const lines = fitLines(top, W - 160);
        lines.forEach((ln, i) => outlinedText(ln, W / 2, 92 + i * 70, 62));
      }

      // bottom text
      const bottom = (bottomInput.value || "").trim();
      if (bottom) {
        const lines = fitLines(bottom, W - 160);
        const baseY = H - 120;
        lines.forEach((ln, i) => outlinedText(ln, W / 2, baseY + i * 70, 62));
      }

      // logo coin top-left
      if (logoReady) {
        const ls = 92;
        ctx.save();
        ctx.beginPath();
        ctx.arc(40 + ls / 2, 40 + ls / 2, ls / 2, 0, Math.PI * 2);
        ctx.shadowColor = "rgba(232,192,105,0.8)";
        ctx.shadowBlur = 18;
        ctx.clip();
        ctx.drawImage(logo, 40, 40, ls, ls);
        ctx.restore();
      }

      // $SHIBEUS tag top-right
      ctx.font = "900 30px Cinzel, serif";
      ctx.textAlign = "right";
      ctx.fillStyle = "#f0cd7a";
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 6;
      ctx.fillText("$SHIBEUS", W - 44, 66);
      ctx.shadowBlur = 0;

      // username pill bottom-right
      let handle = (userInput.value || "").trim().replace(/^@+/, "");
      if (handle) {
        const label = "@" + handle;
        ctx.font = "700 28px Inter, sans-serif";
        const tw = ctx.measureText(label).width;
        const padX = 22, pillH = 50, pillW = tw + padX * 2;
        const px = W - 44 - pillW, py = H - 78;
        ctx.fillStyle = "rgba(11,10,6,0.78)";
        roundRect(px, py, pillW, pillH, 25);
        ctx.fill();
        ctx.strokeStyle = "rgba(232,192,105,0.85)";
        ctx.lineWidth = 2;
        roundRect(px, py, pillW, pillH, 25);
        ctx.stroke();
        ctx.fillStyle = "#f4ecd8";
        ctx.textAlign = "left";
        ctx.fillText(label, px + padX, py + 33);
      }
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    // events
    [topInput, bottomInput, userInput].forEach((el) =>
      el.addEventListener("input", draw)
    );
    bgButtons.forEach((b) =>
      b.addEventListener("click", () => {
        bgButtons.forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        loadBg(b.dataset.src);
      })
    );
    if (bgButtons[0]) bgButtons[0].classList.add("active");

    // download
    $("#memeDownload")?.addEventListener("click", () => {
      draw();
      const link = document.createElement("a");
      const handle = (userInput.value || "shibeus").trim().replace(/^@+/, "") || "shibeus";
      link.download = `shibeus-meme-${handle}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    });

    // share to X (text + reminder to attach the downloaded image)
    $("#memeShare")?.addEventListener("click", () => {
      const handle = (userInput.value || "").trim().replace(/^@+/, "");
      const text = `Veni. Vidi. HODL. ⚔️ The legion rides for $SHIBEUS Maximus 🏛️${handle ? " — @" + handle : ""}`;
      const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
      window.open(url, "_blank", "noopener");
    });

    // ensure fonts are loaded before first render
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(draw);
    }
    loadBg(bgSrc);
  }
})();
