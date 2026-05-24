# Anki Anywhere

A polished Anki-style flashcard app for web + mobile with:

- responsive React UI
- Convex backend for cloud state
- per-user auth
- resumable study sessions
- Anki-style review buttons (`Again`, `Hard`, `Good`, `Easy`)
- card import from CSV / TSV / JSON / `front::back::tags` text

## What it does

- Saves decks, cards, scheduling state, and current study position per user
- Lets you stop mid-session and continue later
- Works well on phone and desktop
- Uses Convex as the system of record for cards + study state

## Stack

- React + Vite
- Convex
- Convex Auth (password)
- Framer Motion

## Important deployment note

Convex handles the backend, database, realtime sync, and auth.

Your **frontend still needs static hosting**.

You can use either:
- **GitHub Pages** for the frontend
- **Vercel** for the frontend
- **Convex** for backend/auth/data

This repo is now prepared for **GitHub Pages** deployment via GitHub Actions.

## Local setup

```bash
npm install
npx convex dev
npm run dev
```

During first Convex setup, login/select/create your project when prompted.

If Convex Auth asks for initialization in your environment, run:

```bash
npx @convex-dev/auth
```

Then keep these app files as the source of truth:
- `convex/auth.ts`
- `convex/http.ts`
- `convex/schema.ts`

## Environment

Convex will populate `VITE_CONVEX_URL` locally after `npx convex dev`.

For production frontend hosting, set:

```bash
VITE_CONVEX_URL=your_production_convex_url
```

## Production deploy

### 1. Deploy Convex backend

```bash
npx convex deploy
```

### 2. Deploy frontend with GitHub Pages

This repo includes a workflow at:

```txt
.github/workflows/deploy-pages.yml
```

After pushing to GitHub:

1. Open the repository on GitHub
2. Go to **Settings → Pages**
3. Set **Source** to **GitHub Actions**
4. Go to **Settings → Secrets and variables → Actions → Variables**
5. Add this repository variable:

```txt
VITE_CONVEX_URL=https://<your-deployment>.convex.cloud
```

6. Push to `main` (or manually run the workflow)
7. GitHub will publish the site at:

```txt
https://<your-github-username>.github.io/<repo-name>/
```

Notes:
- The workflow automatically sets the Vite base path for GitHub Pages.
- It also creates `404.html` so refreshes work better on Pages.
- GitHub Pages hosts only the frontend. Convex remains the backend.

### 3. Optional: deploy frontend with Vercel instead

Build command:

```bash
npm run build
```

Output directory:

```bash
dist
```

Set this env var in Vercel:

```bash
VITE_CONVEX_URL=https://<your-deployment>.convex.cloud
```

### 4. Verify auth + data

- create account
- create a deck
- import cards
- review a few cards
- refresh page
- confirm session resumes
- open on phone and confirm sync

## Import formats

### CSV / TSV

```csv
front,back,tags,hint,source
What is TCP?,Transmission Control Protocol,networks,Transport layer,lecture 3
```

### JSON

```json
[
  { "front": "What is a mutex?", "back": "A mutual exclusion primitive", "tags": ["os"] }
]
```

### Plain text

```txt
Front side::Back side::tag1,tag2
```

## Current scheduler behavior

The app uses an SM-2/Anki-inspired review flow:
- learning cards use short-minute steps
- review cards schedule in day intervals
- `Again / Hard / Good / Easy` update interval and ease

It is intentionally close to Anki behavior, but not a byte-for-byte clone of Anki's latest FSRS internals.

## Files worth knowing

- `src/App.tsx` — main UI
- `convex/myFunctions.ts` — deck/card/session logic
- `convex/schema.ts` — database schema
- `convex/auth.ts` — password auth provider

## Validation completed

- `npm run build` ✅
- `npm run lint` ✅ (generated Convex files still emit harmless warnings)
- GitHub Pages workflow added ✅
