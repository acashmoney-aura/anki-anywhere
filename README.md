# Anki Anywhere

Anki-style flashcards for web + mobile.

## Features

- per-user sync with Convex
- resumable study sessions
- imports from CSV / TSV / JSON / `front::back::tags`
- `Again / Hard / Good / Easy` scheduling tuned closely to classic Anki defaults

## Stack

- React + Vite
- Convex
- Convex Auth
- Framer Motion

## Local setup

```bash
npm install
npx convex dev
npx @convex-dev/auth
npm run dev
```

## Environment

```bash
VITE_CONVEX_URL=your_convex_url
```

## GitHub Pages deploy

This repo includes `.github/workflows/deploy-pages.yml`.

Set this GitHub Actions variable before deploying:

```txt
VITE_CONVEX_URL=https://<your-deployment>.convex.cloud
```

If auth is not initialized on the Convex deployment yet, run:

```bash
npx @convex-dev/auth --prod --deployment-name <your-deployment-name>
```

## Scheduler note

The scheduler is now much closer to classic upstream Anki behavior for the default deck:

- learning steps: `1m`, `10m`
- relearning step: `10m`
- new-card button behavior closer to Anki (`Again≈1m`, `Hard≈5.5m`, `Good≈10m`, `Easy≈4d`)
- graduation: `1d` on Good, `4d` on Easy
- review multipliers: Hard `1.2x`, Easy bonus `1.3x`
- ease changes: Again `-0.20`, Hard `-0.15`, Easy `+0.15`
- lapse handling with 1-day minimum lapse interval + relearning step
- deterministic review fuzz so intervals don’t stay unrealistically rigid
- early-review handling closer to Anki’s classic non-FSRS logic

Still not full Anki desktop parity yet. Missing pieces include things like sibling burying, filtered decks, per-deck option groups, FSRS memory-state scheduling, day-cutoff behavior, and revlog-grade analytics.

## Verify after deploy

- sign up
- create a deck
- import cards
- review a few cards
- refresh the page
- confirm progress resumes
- test on mobile
