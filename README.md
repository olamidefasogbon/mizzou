# Mizzou

Mizzou is a conversational web app that helps applicants track opportunities from official sources.

## Built during the hackathon

Built during the hackathon event, Oct 27 to Nov 4, 2026.

What exists so far:

- Monorepo scaffold (`apps/web`, `packages/core`, `packages/eval`)
- Meta Model API client and helpers in `packages/core/src/meta`
- Eval harness with fixtures and a baseline report in `docs/`
- Web app shell with chat and calendar API routes in `apps/web/src/app`

## Meta models and tools used and where

- `muse-spark-1.3` via the Model API in `packages/core/src/meta` (`client.ts`, `registry.ts`, `pricing.ts`, `callModel.ts`)
- Muse Code built the project
- Nothing else until it is actually used.

## Setup

```sh
pnpm install
```

Copy `.env.example` to `.env.local` and fill in values. Variable names in `.env.example`:

- `MODEL_API_KEY`
- `META_API_KEY` (legacy fallback)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `PER_USER_DAILY_USD`
- `GLOBAL_DAILY_USD`
- `GUEST_RUNS_PER_DAY`

```sh
pnpm dev
```

## Status

See [STATUS.md](STATUS.md).
