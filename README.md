# pairly-english-server

Backend API for the Pairly (Collaborative English Learning Platform) frontend. It owns the
PostgreSQL credit ledger for AI feature usage and, in a later stage, will proxy AI requests
to the Mindlogic (factchat-cloud) gateway.

This service is intentionally a **separate git repository** from the frontend — see
[Relationship to the frontend](#relationship-to-the-frontend-repository) below.

## Purpose

- Track how many Mindlogic credits the product has used per calendar month, so a **hard cap
  of 5,000 credits/month** is enforced before any AI call is made.
- Reserve credits atomically before an outbound AI call and commit/release them afterward,
  so concurrent requests can never double-spend the monthly budget.
- Keep the Mindlogic API key server-side only, never shipped to the browser.
- Expose `/api/v1/usage` so the frontend can show usage/quota state to users.

**Status: no real Mindlogic API calls are made anywhere in this codebase yet.** The Mindlogic
client (`src/services/mindlogic/client.ts`) is a typed skeleton; nothing calls
`createChatCompletion`, `getModels`, or `getCredits` from a route.

## Tech stack

| Concern | Choice |
| --- | --- |
| Runtime | Node.js 22 |
| Language | TypeScript 5.9 (strict) |
| Package manager | pnpm 10.34.3 |
| HTTP framework | Fastify 5 |
| Database | PostgreSQL |
| ORM | Drizzle ORM (`drizzle-orm/node-postgres`) |
| Validation | Zod 4 |
| Tests | Vitest 4 + Fastify `inject()` |
| Logging | Pino (Fastify's built-in logger, with header redaction) |
| Lint / format | ESLint 10 (flat config) + Prettier 3 |

Toolchain versions are pinned in [`.mise.toml`](./.mise.toml) (Node 22, pnpm 10.34.3).

## Installation

```bash
mise install     # installs the pinned Node 22 / pnpm 10.34.3, if you use mise
pnpm install
```

## Environment variables

Copy the example file and fill in real values yourself — **nothing in this repository ever
contains a real API key or database URL**, and the frontend's `.env.local` is never read or
copied into this project.

```bash
cp .env.example .env.local
```

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production` |
| `PORT` | no | `3001` | |
| `HOST` | no | `127.0.0.1` | |
| `DATABASE_URL` | **yes** | — | PostgreSQL connection string |
| `FRONTEND_ORIGIN` | no | `http://localhost:5173` | Single CORS origin — wildcards are rejected in every environment |
| `MINDLOGIC_API_KEY` | **yes** | — | Never logged, never returned in any response |
| `MINDLOGIC_BASE_URL` | no | `https://factchat-cloud.mindlogic.ai/v1/gateway` | |
| `MINDLOGIC_MODEL` | no | `claude-haiku-4-5-20251001` | Must be a key in `MODEL_CREDIT_RATES` (`src/services/mindlogic/credit-rates.ts`) — validated at boot |
| `MINDLOGIC_MONTHLY_CREDIT_LIMIT` | no | `5000` | |

Validation happens in `src/config/env.ts` via Zod. Invalid configuration throws at startup
with the field name and a generic reason — **secret values are never included in the error
message**, so a bad `MINDLOGIC_API_KEY` never gets echoed anywhere.

`.env`, `.env.local`, and `.env.*.local` are git-ignored. Only `.env.example` is tracked.

## Development server

```bash
pnpm dev
```

Starts Fastify with `tsx watch` against `src/server.ts`, reading `.env.local` via `dotenv`.

## Tests

```bash
pnpm test        # watch mode
pnpm test:run    # single run (used in CI)
```

46 tests currently cover: env validation, CORS allow/deny + wildcard rejection, credit
calculation and rounding, 80/90%/exhausted warning levels, Asia/Seoul month-boundary and
reset-date math, reservation limit rejection, requestId idempotency, the full credit
lifecycle (reserve → commit / release), the Mindlogic client's status-code → error-code
mapping and API-key non-leakage, and the `/health`, `/ready`, `/api/v1/usage` HTTP routes
via Fastify's `inject()`.

### What is *not* yet tested

`DrizzleCreditRepository` (`src/services/credits/credit-repository.ts`) — the real
PostgreSQL-backed implementation using a transaction + `SELECT ... FOR UPDATE` — has **no
automated test against a real PostgreSQL instance**. The business rules it must satisfy
(limit rejection, idempotent replay) are unit-tested against `CreditRepository`, the
storage-agnostic interface it implements, using an in-memory fake
(`tests/helpers/in-memory-credit-repository.ts`). That fake is a plain JS `Map`, **not**
SQLite standing in for PostgreSQL — it verifies `CreditService`'s logic, not PostgreSQL's
transaction/locking semantics.

**Follow-up work**: add a Testcontainers-based integration test that spins up a real
PostgreSQL container, runs the migrations, and exercises `DrizzleCreditRepository` directly
— in particular concurrent `reserveCredits()` calls racing against the same billing month, to
confirm `SELECT ... FOR UPDATE` actually serializes them.

## Database / migrations

Schema lives in `src/db/schema.ts`; migrations are generated with Drizzle Kit into
`src/db/migrations/`.

```bash
pnpm db:generate   # regenerate SQL migrations from schema.ts (no DB connection needed)
pnpm db:migrate    # apply pending migrations to DATABASE_URL
pnpm db:studio     # open Drizzle Studio against DATABASE_URL
```

The initial migration (`src/db/migrations/0000_puzzling_brood.sql`) has been generated but
**has not been applied to any real database** — no PostgreSQL connection was available while
building this project. Run `pnpm db:migrate` yourself once `DATABASE_URL` in `.env.local`
points at a real, reachable PostgreSQL instance.

### Schema

- **`credit_periods`** — one row per calendar month (`billing_month`, `'YYYY-MM'`, PK),
  tracking `committed_credits`, `reserved_credits`, `provider_reported_credits`, and an
  `exhausted` flag.
- **`credit_usage_records`** — one row per AI request (`request_id` UUID PK), with `feature`
  and `status` enums, token counts, and reserved/used credits.

Deliberately **excluded** from `credit_usage_records`: essay/reflection text, full news
articles, transcripts, audio files, or any other original learner content. Only accounting
metadata is stored.

## Credit hard cap

- Only models listed in `MODEL_CREDIT_RATES` (`src/services/mindlogic/credit-rates.ts`) may
  ever be used. The client cannot choose a model; the server's own `MINDLOGIC_MODEL` is
  validated against this same allow-list at boot. There is no automatic fallback to a
  cheaper or different model.
- Credits are computed per 1,000 input/output tokens and **rounded up** (`Math.ceil`), since
  Mindlogic's docs do not specify a rounding rule and under-billing against the cap is unsafe.
- `CreditService.reserveCredits()` (`src/services/credits/credit-service.ts`) rejects a
  reservation — **before any Mindlogic call is made** — whenever
  `committed + reserved + requested > monthlyLimit` (5,000 by default).
- The same `requestId` submitted twice returns the original reservation instead of reserving
  twice (idempotency), enforced inside the same database transaction as the limit check.
- Warning levels (`ok` / `warning80` / `warning90` / `exhausted`) and `usagePercent` are
  computed against committed + reserved credits, so a client sees the warning rise even
  before a reservation is committed.
- 402 (payment/credit exhausted) is never retried. 429/5xx retry policy exists only as types
  and constants (`RETRYABLE_ERROR_CODES`, `MAX_RETRY_ATTEMPTS`, ...) in
  `src/services/mindlogic/types.ts` — it is not wired into any outbound call yet, because no
  outbound call exists yet.

## Endpoints implemented

- `GET /health` — liveness only; no DB or Mindlogic dependency.
- `GET /ready` — checks env was loaded successfully and that PostgreSQL is reachable. Does
  **not** call Mindlogic.
- `GET /api/v1/usage` — returns a `UsageSummary` computed entirely from our own database
  ledger (`credit_periods` / `credit_usage_records`). No outbound Mindlogic call.

## Security notes

- CORS allows exactly one origin (`FRONTEND_ORIGIN`) with credentials; a wildcard `*` is
  rejected at both env-validation time and inside `registerCors()`, in every environment.
- JSON body size is capped (100 KB).
- Error responses never include a stack trace or internal file path — see
  `src/plugins/error-handler.ts`. Full errors are logged server-side only.
- Every request gets a UUID `request-id` (`genReqId`), echoed in error responses for
  correlation.
- Pino redacts `Authorization` and `Cookie` headers from logs (`src/app.ts`). The Mindlogic
  client never logs or returns the API key (see `src/services/mindlogic/client.test.ts` for
  the corresponding test).
- **No authentication/authorization is implemented yet.** All routes are currently open.
  Before this service is exposed beyond local development, it needs an auth layer (e.g.
  session or token-based) gating `/api/v1/*` — deliberately deferred so this initial scaffold
  stays minimal per the current project stage.

## Relationship to the frontend repository

This is a **separate git repository**, a sibling directory of the frontend
(`Collaborative English Learning Platform`), not a subdirectory of it. The frontend and
backend are versioned, deployed, and released independently.

### Why the Mindlogic API key must never go in the frontend

The frontend is static, browser-delivered code — anything bundled into it (including
`import.meta.env.VITE_*` values) is visible to any user who opens devtools or views the
network tab. An API key shipped to the browser is a public secret: any user (or a bot
scraping bundles) could extract it and make unlimited billed requests to Mindlogic under this
project's account, blowing through the credit cap outside of this server's control entirely.
Keeping the key server-side, behind this repository's own credit-reservation logic, is the
only way the monthly hard cap can actually be enforced.

## Next steps (not yet implemented)

- Wire an actual AI route that calls `CreditService.reserveCredits()` →
  `MindlogicClient.createChatCompletion()` → `commitCredits()`/`releaseCredits()`.
- Apply the 429/5xx retry policy (types already exist) to real outbound Mindlogic calls.
- Testcontainers-based PostgreSQL integration tests for `DrizzleCreditRepository`, especially
  concurrent reservation races.
- Authentication/authorization for `/api/v1/*`.
- Reconciliation job comparing `provider_reported_credits` (from Mindlogic's own `getCredits()`)
  against our internal ledger, using the existing `reconciliation_adjustment` feature enum.
