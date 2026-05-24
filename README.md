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

Recommended:
- **Vercel** for the frontend
- **Convex** for backend/auth/data

This matches Convex's own deployment guidance.

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

### 2. Deploy frontend

Push this repo to GitHub, then import it into Vercel.

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

### 3. Verify auth + data

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
