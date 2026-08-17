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

| Concern         | Choice                                                  |
| --------------- | ------------------------------------------------------- |
| Runtime         | Node.js 22                                              |
| Language        | TypeScript 5.9 (strict)                                 |
| Package manager | pnpm 10.34.3                                            |
| HTTP framework  | Fastify 5                                               |
| Database        | PostgreSQL                                              |
| ORM             | Drizzle ORM (`drizzle-orm/node-postgres`)               |
| Validation      | Zod 4                                                   |
| Tests           | Vitest 4 + Fastify `inject()`                           |
| Logging         | Pino (Fastify's built-in logger, with header redaction) |
| Lint / format   | ESLint 10 (flat config) + Prettier 3                    |

Toolchain versions are pinned in [`.mise.toml`](./.mise.toml) (Node 22, pnpm 10.34.3).

## Installation

```bash
mise install     # installs the pinned Node 22 / pnpm 10.34.3, if you use mise
pnpm install
```

`pnpm test:integration` additionally requires a running Docker daemon (Docker Desktop or
equivalent) — it boots real, throwaway PostgreSQL containers via Testcontainers. Everything
else (`dev`, `build`, `test:run`, `lint`, `typecheck`) has no Docker dependency.

## Environment variables

Copy the example file and fill in real values yourself — **nothing in this repository ever
contains a real API key or database URL**, and the frontend's `.env.local` is never read or
copied into this project.

```bash
cp .env.example .env.local
```

| Variable                         | Required | Default                                          | Notes                                                                                                |
| -------------------------------- | -------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                       | no       | `development`                                    | `development` \| `test` \| `production`                                                              |
| `PORT`                           | no       | `3001`                                           |                                                                                                      |
| `HOST`                           | no       | `127.0.0.1`                                      |                                                                                                      |
| `DATABASE_URL`                   | **yes**  | —                                                | PostgreSQL connection string                                                                         |
| `FRONTEND_ORIGIN`                | no       | `http://localhost:5173`                          | Single CORS origin — wildcards are rejected in every environment                                     |
| `MINDLOGIC_API_KEY`              | **yes**  | —                                                | Never logged, never returned in any response                                                         |
| `MINDLOGIC_BASE_URL`             | no       | `https://factchat-cloud.mindlogic.ai/v1/gateway` |                                                                                                      |
| `MINDLOGIC_MODEL`                | no       | `claude-haiku-4-5-20251001`                      | Must be a key in `MODEL_CREDIT_RATES` (`src/services/mindlogic/credit-rates.ts`) — validated at boot |
| `MINDLOGIC_MONTHLY_CREDIT_LIMIT` | no       | `5000`                                           |                                                                                                      |

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
pnpm test              # watch mode (fast unit tests only)
pnpm test:run          # fast unit tests, single run — no Docker required (used in CI)
pnpm test:integration  # real PostgreSQL integration tests via Testcontainers — requires Docker
pnpm test:all          # test:run + test:integration
```

### Fast unit tests (`pnpm test:run`, 50 tests, no Docker)

Cover: env validation, CORS allow/deny + wildcard rejection, credit calculation and rounding,
80/90%/exhausted warning levels, Asia/Seoul month-boundary and reset-date math, reservation
limit rejection, requestId idempotency, requestId-payload-conflict rejection,
invalid-state-transition rejection (double commit/release), the full credit lifecycle
(reserve → commit / release), the Mindlogic client's status-code → error-code mapping and
API-key non-leakage, and the `/health`, `/ready`, `/api/v1/usage` HTTP routes via Fastify's
`inject()`.

These run `CreditService`'s business rules against `InMemoryCreditRepository`
(`tests/helpers/in-memory-credit-repository.ts`) — a plain JS `Map`, **not** a stand-in for
PostgreSQL. It verifies `CreditService`'s logic, never PostgreSQL's transaction/locking
semantics — that's what the integration suite below is for.

### PostgreSQL integration tests (`pnpm test:integration`, 24 tests, requires Docker)

Uses [Testcontainers](https://node.testcontainers.org/) to boot a real, throwaway
`postgres:16-alpine` container per test file, apply the actual Drizzle migrations from
`src/db/migrations/`, and exercise `DrizzleCreditRepository` directly against it. The
container is torn down in `afterAll`; tables are `TRUNCATE`d in `beforeEach` for isolation
between tests. **Never connects to a developer's local or remote database** — Docker must be
running, or these tests fail to start (they do not fall back to SQLite or any other engine).

- `tests/integration/credit-repository.postgres.test.ts` — basic reservation, successful
  settlement, failure release, idempotency, **20 truly concurrent requests sharing one
  requestId** (collapses to exactly one reservation, zero unique-violations, zero rejected
  promises), **concurrent requests sharing a requestId with conflicting payloads** (exactly
  one wins, the other is rejected with `IdempotencyConflictError`, ledger never corrupted),
  the original 10-requests-different-requestId monthly-limit race (kept as a regression
  check), exact-limit boundary, and double-settlement guards (reject double-commit,
  double-release, release-after-commit, commit-after-release, a reserve→commit/release race;
  `reserved_credits` never goes negative).
- `tests/integration/migrations.postgres.test.ts` — migration applies cleanly to an empty
  database, migration re-run is a no-op, foreign key / enum / `CHECK` constraint enforcement
  at the database level, and integer round-trip precision (no numeric/bigint string coercion,
  since the schema uses `integer` throughout).

## Database / migrations

Schema lives in `src/db/schema.ts`; migrations are generated with Drizzle Kit into
`src/db/migrations/`.

```bash
pnpm db:generate   # regenerate SQL migrations from schema.ts (no DB connection needed)
pnpm db:migrate    # apply pending migrations to DATABASE_URL
pnpm db:studio     # open Drizzle Studio against DATABASE_URL
```

The initial migration (`src/db/migrations/0000_salty_mariko_yashida.sql`) has been generated
and is applied automatically to a throwaway container by every `pnpm test:integration` run,
but it has **not been applied to any persistent or remote database** — no such connection was
available while building this project. Run `pnpm db:migrate` yourself once `DATABASE_URL` in
`.env.local` points at a real, reachable PostgreSQL instance.

This migration was regenerated once (originally `0000_puzzling_brood.sql`) to add the `CHECK`
constraints described below, discovered while writing the integration tests. Since it had
never been applied anywhere real, the safest option was to fold the constraints into a fresh
initial migration rather than layer an `ALTER TABLE` migration on top of a schema no
environment has ever run — once a migration has shipped to any real database, this project
will switch to additive migrations only.

### Schema

- **`credit_periods`** — one row per calendar month (`billing_month`, `'YYYY-MM'`, PK),
  tracking `committed_credits`, `reserved_credits`, `provider_reported_credits`, and an
  `exhausted` flag.
- **`credit_usage_records`** — one row per AI request (`request_id` UUID PK), with `feature`
  and `status` enums, token counts, and reserved/used credits.

Both tables also carry `CHECK` constraints requiring every credit/token count to be
non-negative (`>= 0`) — defense in depth confirmed by the integration suite's "check
constraint enforcement" tests, in addition to the application-level guarantees described
below.

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
- The same `requestId` submitted twice — even fully concurrently, not just sequentially —
  returns the original reservation instead of reserving twice (idempotency). `reserveCredits()`
  claims the `requestId` via `INSERT ... ON CONFLICT (request_id) DO NOTHING RETURNING *`
  _inside_ the same `SELECT ... FOR UPDATE`-locked section used for the limit check, rather
  than checking existence with a separate, unlocked `SELECT` beforehand — that earlier
  check-then-act gap was a real TOCTOU race (see `git log` on `credit-repository.ts` for the
  fix) that let concurrent duplicate requestIds both pass the "does it exist" check and race
  each other into a raw PostgreSQL `unique_violation`. No advisory lock was added: the
  existing per-billing-month `FOR UPDATE` lock already serializes every reservation attempt
  (same requestId or not) against that month, and PostgreSQL's own unique-index arbitration on
  `request_id` independently prevents two callers from both inserting the same id even across
  different months — layering an advisory lock on top would just add a second lock type for
  no additional safety.
- A requestId reused with a **different** feature/model/reserved-amount/`userRef` than the
  reservation already on record is not treated as a replay — it throws
  `IdempotencyConflictError` instead of silently returning the mismatched original.
- If a reservation attempt would exceed the limit, the whole transaction is rolled back —
  including the usage-record row that was speculatively inserted to claim the requestId before
  the limit check ran — so a rejected reservation never leaves a ledger row.
- Warning levels (`ok` / `warning80` / `warning90` / `exhausted`) and `usagePercent` are
  computed against committed + reserved credits, so a client sees the warning rise even
  before a reservation is committed.
- `commitCredits()`/`releaseCredits()` atomically claim the `'reserved' → 'completed'/'released'`
  transition with a single conditional `UPDATE ... WHERE status = 'reserved'`; committing or
  releasing an already-settled `requestId` throws (`InvalidCreditTransitionError`) instead of
  silently no-opping, and `reserved_credits` can never be double-decremented or driven negative
  — verified under real concurrent settlement attempts in the integration suite.
- 402 (payment/credit exhausted) is never retried. 429/5xx retry policy exists only as types
  and constants (`RETRYABLE_ERROR_CODES`, `MAX_RETRY_ATTEMPTS`, ...) in
  `src/services/mindlogic/types.ts` — it is not wired into any outbound call yet, because no
  outbound call exists yet.

### Credit error types (`src/services/credits/errors.ts`)

Four distinct error classes, each with a stable `code` intended for a future API route's JSON
error envelope. **PostgreSQL constraint names and raw SQL error text must never be forwarded
to an HTTP response** — a future route handler maps these `code`s to an HTTP status and a
generic message, the same way `src/plugins/error-handler.ts` already does for uncaught errors.

| Class                          | `code`                      | Thrown when                                                                                                                                                                              |
| ------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CreditLimitExceededError`     | `CREDIT_LIMIT_EXCEEDED`     | Internal only — caught inside `reserveCredits()` and converted back to `{ ok: false, reason: 'limit_exceeded', usage }`; exported for a future route that calls the repository directly. |
| `IdempotencyConflictError`     | `IDEMPOTENCY_CONFLICT`      | A `requestId` is reused with a different feature/model/credits/`userRef`.                                                                                                                |
| `InvalidCreditTransitionError` | `INVALID_CREDIT_TRANSITION` | `commitCredits`/`releaseCredits` called on a record that isn't currently `'reserved'`.                                                                                                   |
| `CreditRecordNotFoundError`    | `CREDIT_RECORD_NOT_FOUND`   | `commitCredits`/`releaseCredits` called with an unknown `requestId`.                                                                                                                     |

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
- Authentication/authorization for `/api/v1/*`.
- CI wiring for `pnpm test:integration` (Docker-in-CI) — not yet added; see
  [Tests](#tests) for the scripts this would run.
- Reconciliation job comparing `provider_reported_credits` (from Mindlogic's own `getCredits()`)
  against our internal ledger, using the existing `reconciliation_adjustment` feature enum.
