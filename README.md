# 🏛️ Shibeus Maximus — Emperor of Memecoins

> *Veni. Vidi. HODL.*

The official meme website for **Shibeus Maximus** — an imperial, Roman-themed
landing page for the immortal meme empire.

![Shibeus Maximus](assets/banner.jpg)

## ✨ Features

- **Cinematic hero** with floating animated coin, glowing ring, and legion banner.
- **The Empire** — story section with trust badges.
- **Tokenomics** — supply, tax, liquidity, and contract cards.
- **How to Buy** — four-step guide + one-click copy contract address.
- **Conquest roadmap** — four-phase imperial campaign timeline.
- **Chronicles gallery** — 12 epic scenes with a full-screen lightbox
  (keyboard + arrow navigation).
- **⚒️ Meme Forge** — an in-browser meme generator: pick a Shibeus scene,
  add top/bottom war cries, stamp your **X handle**, and download a ready-to-post
  1200×675 X-post image — plus a one-click "Share to X" button.
- Fully **responsive**, with reduced-motion support and SEO/Open-Graph tags.

## 🚀 Run it

It's a static site — no build step. Just open `index.html`, or serve locally:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

> The meme generator uses the HTML Canvas API and reads local images, so it must
> be served over `http://` (not opened as a `file://` URL) for downloads to work
> in all browsers.

## 📁 Structure

```
.
├── index.html        # markup
├── styles.css        # imperial gold + emerald theme
├── script.js         # nav, reveals, lightbox, meme generator
└── assets/
    ├── shibeus.png   # the coin / logo
    ├── banner.jpg    # legion hero banner
    └── gallery/      # the Chronicles artwork
```

## 🎨 Theme

Deep imperial black, **gold** (`#e8c069`) leaf, and **emerald** (`#5fe06a`)
energy accents drawn straight from the artwork. Display type is *Cinzel*; body
copy is *Inter*.

---

*$SHIBEUS is a meme coin for entertainment purposes only. Not financial advice. DYOR.*
