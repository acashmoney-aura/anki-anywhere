# Anki Anywhere

A local-first Anki-style flashcard app for web + mobile.

## Features

- browser-local collection persistence (no account required)
- resumable study sessions
- collection export/import as JSON
- basic note types, including `Basic` and `Basic (and reversed card)`
- imports from CSV / TSV / JSON / `front::back::tags`
- `Again / Hard / Good / Easy` scheduling tuned closely to classic Anki defaults

## Stack

- React + Vite
- localStorage-backed collection store
- Framer Motion

## Local setup

```bash
npm install
npm run dev:frontend
```

No backend setup is required for the current local-first version.

## Smoke test

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4176
E2E_BASE_URL=http://127.0.0.1:4176/ npm run test:e2e
```

## GitHub Pages deploy

This repo includes `.github/workflows/deploy-pages.yml`.

No extra environment variables are required for the current GitHub Pages deployment.

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
