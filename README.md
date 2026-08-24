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

**Status: a small number of approved, one-shot real Mindlogic smoke tests have been run** (see
[Procedure for a one-time real smoke test](#procedure-for-a-one-time-real-smoke-test) for the
full history and guard files). Summary, oldest to newest:

| Check                                                                                             | Model                       | Outcome                                                  |
| ------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------- |
| Bare-messages contract check (`provider_contract_check`)                                          | `claude-haiku-4-5-20251001` | Succeeded — `200`                                        |
| Structured-output smoke test, round 1                                                             | `claude-haiku-4-5-20251001` | Failed — Mindlogic rejected structured output with `400` |
| Structured-output smoke test, round 2 (retry)                                                     | `claude-haiku-4-5-20251001` | Failed — Mindlogic rejected structured output with `400` |
| Structured-output smoke test, round 3, after switching `reflection_comparison`'s configured model | `gpt-5.4-mini`              | Succeeded — `200`, valid schema                          |

As a result, `MINDLOGIC_MODEL`/`feature-config.ts` now pins `reflection_comparison` to
`gpt-5.4-mini`; `claude-haiku-4-5-20251001` remains only for the `provider_contract_check`
diagnostic (bare messages, no `response_format`), which it does support. Current provider usage
(from `GET /api/v1/usage`, verified 2026-08-18): `usedCredits: 4`, `remainingCredits: 4996`,
`limitCredits: 5000` — check that endpoint directly for the live figure rather than trusting a
number in this file, since it moves with every real call.

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

| Variable                         | Required | Default                                          | Notes                                                                                                                                            |
| -------------------------------- | -------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`                       | no       | `development`                                    | `development` \| `test` \| `production`                                                                                                          |
| `PORT`                           | no       | `3001`                                           |                                                                                                                                                  |
| `HOST`                           | no       | `127.0.0.1`                                      |                                                                                                                                                  |
| `DATABASE_URL`                   | **yes**  | —                                                | PostgreSQL connection string                                                                                                                     |
| `FRONTEND_ORIGIN`                | no       | `http://localhost:5173`                          | Single CORS origin — wildcards are rejected in every environment                                                                                 |
| `MINDLOGIC_API_KEY`              | **yes**  | —                                                | Never logged, never returned in any response                                                                                                     |
| `MINDLOGIC_BASE_URL`             | no       | `https://factchat-cloud.mindlogic.ai/v1/gateway` |                                                                                                                                                  |
| `MINDLOGIC_MODEL`                | no       | `claude-haiku-4-5-20251001`                      | Must be a key in `MODEL_CREDIT_RATES` (`src/services/mindlogic/credit-rates.ts`) — validated at boot                                             |
| `MINDLOGIC_MONTHLY_CREDIT_LIMIT` | no       | `5000`                                           |                                                                                                                                                  |
| `APP_SHARED_PASSWORD`            | **yes**  | —                                                | Shared password both users log in with (see [Authentication](#authentication)). Min 4 chars. Never logged.                                       |
| `SESSION_SECRET`                 | **yes**  | —                                                | HMAC key for session JWTs. Min 32 chars. Never logged.                                                                                           |
| `SESSION_MAX_AGE_SECONDS`        | no       | `2592000` (30 days)                              | Session cookie / JWT lifetime                                                                                                                    |
| `AI_DEV_ACCESS_TOKEN`            | no       | —                                                | CLI smoke-script-only bearer token; never accepted in production (see [Authentication](#authentication))                                         |
| `STUDY_DAY_MAX_FUTURE_DAYS`      | no       | `1`                                              | How many days ahead of "today" (Asia/Seoul) a `study_days` date may be (see [Daily reflections](#daily-reflections--study-day-based-comparison)) |

Validation happens in `src/config/env.ts` via Zod. Invalid configuration throws at startup
with the field name and a generic reason — **secret values are never included in the error
message**, so a bad `MINDLOGIC_API_KEY` never gets echoed anywhere.

`src/config/env.ts` loads `.env.local` first and `.env` as a fallback (`.env.local` values
win); a plain `dotenv/config` import — the previous behavior — only reads `.env`, which this
project never uses, so real secrets in `.env.local` were silently never loaded. Fixed once
this was caught while wiring up the first real Mindlogic connectivity check.

`.env`, `.env.local`, and `.env.*.local` are git-ignored. Only `.env.example` is tracked.

## Authentication

MVP-scoped, intentionally minimal: **one shared password, no per-user accounts, no email, no
invite codes.** Both learners log in with their own display name plus the same
`APP_SHARED_PASSWORD`.

- **`POST /api/v1/auth/login`** — body `{ name, password }`. `name` is trimmed, 1–40 chars,
  rejected if it contains control characters (`src/services/auth/schema.ts`); it is a
  **display-only value, never an authorization check** — two people can log in with the same
  name. `password` is compared against `APP_SHARED_PASSWORD` with a timing-safe comparison
  (`src/services/auth/password.ts`): both sides are SHA-256 hashed to a fixed 32-byte digest
  before `crypto.timingSafeEqual`, so a length mismatch in the submitted password can't itself
  leak through comparison timing (`timingSafeEqual` throws on differing lengths, which is
  otherwise a non-constant-time early exit). On success, sets an HttpOnly session cookie and
  returns `{ name }`. On failure, `400` for a malformed body or `401` for a wrong password —
  the same generic `"Invalid name or password"` message and `INVALID_CREDENTIALS` code either
  way, regardless of what name was submitted, since there's no per-user record to distinguish
  against in the first place. Rate-limited to 5 requests/minute/caller (`LOGIN_RATE_LIMIT` in
  `src/routes/auth.ts`) — separate from, and stricter than, the reflections route's limit.
- **`GET /api/v1/auth/session`** — returns `{ authenticated: true, name }` for a valid,
  unexpired, correctly-signed session cookie, or `{ authenticated: false }` for anything else
  (missing, expired, tampered, wrong secret) — never an error status, so the frontend can poll
  this on load to restore session state after a refresh.
- **`POST /api/v1/auth/logout`** — clears the session cookie, returns `204`.
- **Session shape** (`src/services/auth/session.ts`): a **stateless** JWT (HS256, via the
  `jsonwebtoken` library — no hand-rolled crypto) carrying `{ name, exp }`, signed with
  `SESSION_SECRET`. Nothing is stored server-side, so a server restart never invalidates
  existing sessions. Defaults to a 30-day lifetime (`SESSION_MAX_AGE_SECONDS`).
- **Cookie**: `HttpOnly` always; `Secure` only when `NODE_ENV=production` (a `Secure` cookie is
  silently dropped by the browser over the plain `http://localhost` this app uses in local
  dev); `SameSite=Lax`; `Path=/`. The password itself is never put in the cookie, only ever
  compared server-side and discarded.
- **Protecting the AI route**: `POST /api/v1/reflections/compare` requires a valid session (see
  `src/plugins/auth-gate.ts`, described further below) in every environment, including
  production. The session's `name` is available as an internal reference but is still treated
  as display-only, never as an authorization check — holding _any_ valid session is sufficient,
  matching the "one shared household password" threat model this MVP targets.
- **What this is not**: there is no per-user identity, no rate limiting _per person_ (only per
  IP), and nothing stops one logged-in browser from spending the other user's share of the
  shared 5,000-credit/month budget. See the security-notes warning further below before
  considering any public deployment.

## Mindlogic connectivity check

```bash
pnpm mindlogic:check
```

`scripts/mindlogic-check.ts` is a standalone, read-only operational script — **not** part of
the running application (not imported by `src/app.ts`/`src/server.ts`, and excluded from
`pnpm build`'s output since `tsconfig.build.json` only includes `src/**`). It exists to answer
"can this server actually reach Mindlogic with the configured credentials" without risking any
credit spend.

It performs exactly two requests and nothing else:

- `GET /models/` — reports HTTP status, total model count, and whether the configured
  `MINDLOGIC_MODEL` is present in the response.
- `GET /credits/` — reports HTTP status, `monthly_allocated.{quota,used,remaining}`,
  its `renewal_date`, `purchased`/`total` summaries, and whether the reported `quota` matches
  `MINDLOGIC_MONTHLY_CREDIT_LIMIT` (mismatches are reported, never auto-corrected).

It never sends a POST, never calls `createChatCompletion`, never prints the API key or an
`Authorization` header, and never dumps a full raw response body — only the summarized fields
above. `MindlogicClient` (`src/services/mindlogic/client.ts`) itself has no dependency on
`src/config/env.ts`, specifically so this script can run with only the four `MINDLOGIC_*`
variables set — it does not require `DATABASE_URL`. The app's own env wiring
(`createMindlogicClient()` in `src/services/mindlogic/create-client.ts`, for future route use)
is what pulls in the full env schema; this script bypasses that on purpose.

Its core logic (`runMindlogicCheck`) is unit-tested with a mocked `fetchImpl`
(`scripts/mindlogic-check.test.ts`) — no real network call happens in `pnpm test:run`.

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

### Fast unit tests (`pnpm test:run`, 251 tests, no Docker)

Cover: env validation, CORS allow/deny + wildcard rejection, credit calculation and rounding,
80/90%/exhausted warning levels, Asia/Seoul month-boundary and reset-date math, reservation
limit rejection, requestId idempotency, requestId-payload-conflict rejection,
invalid-state-transition rejection (double commit/release, and the new
`reconciliation_pending` transitions — mark/reconcileCommit/reconcileRelease, both directions
rejected from the wrong state), the full credit lifecycle (reserve → commit / release /
mark-pending / reconcile), `evaluateReconciliation()`'s verdicts (in-sync auto-release,
negative-discrepancy flagged but still auto-releasable, unexplained discrepancy with no
pending records, ambiguous multi-candidate never bulk-released, discrepancy exceeding total
pending, and the conservative-baseline/remaining-budget math), the Mindlogic client's
status-code → error-code mapping (including `timeout` / `connection_refused` /
`connection_reset` / `incomplete_response` as distinct codes) and API-key non-leakage,
byte-length-upper-bound token estimation (ASCII/Korean/emoji, with/without a
`response_format` schema), the reflection-comparison request/response Zod schemas
(length/blank bounds, exactly-3-topics, `additionalProperties: false` parity), the full
reserve→call→settle credit pipeline for reflection comparison (429/5xx retry, no-retry on 402
and all uncertain-billing codes, release-on-certain-failure,
hold-as-pending-on-uncertain-failure, blocked same-requestId retry while pending, pending
reservations still counting against the budget, actual-usage-exceeds-reservation fail-closed,
no silent-double-charge on requestId reuse, sane bounded reservation sizes for Korean/emoji/
maximum-length input) against a mocked Mindlogic `fetchImpl`, and the `/health`, `/ready`,
`/api/v1/usage`, `/api/v1/reflections/compare` HTTP routes via Fastify's `inject()` —
including the pre-auth gate (prod always 404, missing-token 503, wrong-token 401) and a
log-capture test proving reflection text/names/the API key never reach the logger. Also
covers `scripts/mindlogic-check.ts`'s summary logic (GET-only, quota-mismatch detection, no
key leakage) against a mocked `fetchImpl`.

`tests/study-days.test.ts` covers the daily-reflections HTTP routes (see [Daily
reflections](#daily-reflections--study-day-based-comparison)) against an in-memory
`DailyReflectionRepository` fake (`tests/helpers/in-memory-daily-reflection-repository.ts`):
401 without a session on all 3 routes, a successful submission's exact response shape,
reflection length/blank validation, the `.strict()` schema rejecting a client-supplied identity
field, idempotent same-participant resubmission (no duplicate row, no content overwrite),
`ARTICLE_MISMATCH` for a different article on an already-registered date, status before/after
the partner submits (never exposing partner content), `readyToCompare` only flipping true at 2
distinct participants, `PARTNER_NOT_READY` on compare with 0 or 1 submitted, a successful
compare against a mocked Mindlogic client, a genuine 3rd distinct name rejected with
`PARTICIPANT_LIMIT_REACHED`, fixed-time date-range validation at and past the future boundary,
and a log-capture test proving displayName/content/the raw participant key never reach the
logger.

`tests/comparison-fingerprint.test.ts`, `tests/comparison-service.test.ts`, and
`tests/study-days-comparison.test.ts` cover the study-day-comparison caching/locking feature
(see [Study-day comparison](#study-day-comparison--caching-locking-crash-safety)) against an
in-memory `ComparisonRepository` fake (`tests/helpers/in-memory-comparison-repository.ts`):
`computeInputFingerprint`'s order-independence and irreversibility, `ComparisonService`'s
read-side and write-side schema (re-)validation (a corrupted stored result is detected and
never passed through as `'completed'`), `PARTNER_NOT_READY` with 0/1 reflections, exactly one
provider call on first generation with the result persisted and returned via both `POST
/compare` and `GET /comparison`, a second `POST /compare` served from cache (`cached: true`,
zero additional provider calls) with both participants seeing the identical result via `GET`,
a concurrent request arriving while phase 2 is still in flight getting `202 processing` without
a second provider call, a certain upstream failure settling to `'failed'` and **never**
auto-retried by plain `POST /compare` (provider call count stays flat across repeated POSTs),
`POST .../comparison/retry`'s `NOTHING_TO_RETRY`/`ALREADY_COMPLETED`/`RECONCILIATION_PENDING`
rejections, a successful retry on a `'failed'` row re-attempting generation, and a timeout
settling to `'reconciliation_pending'` with retry rejected and the provider never re-called.

These run `CreditService`'s business rules against `InMemoryCreditRepository`
(`tests/helpers/in-memory-credit-repository.ts`) — a plain JS `Map`, **not** a stand-in for
PostgreSQL. It verifies `CreditService`'s logic, never PostgreSQL's transaction/locking
semantics — that's what the integration suite below is for.

### PostgreSQL integration tests (`pnpm test:integration`, 58 tests, requires Docker)

Uses [Testcontainers](https://node.testcontainers.org/) to boot a real, throwaway
`postgres:16-alpine` container per test file, apply the actual Drizzle migrations from
`src/db/migrations/`, and exercise `DrizzleCreditRepository` (and, for the reflections route,
the full Fastify app) directly against it. Containers are torn down in `afterAll`; tables are
`TRUNCATE`d in `beforeEach` for isolation between tests. **Never connects to a developer's
local or remote database** — Docker must be running, or these tests fail to start (they do
not fall back to SQLite or any other engine). This is entirely separate from the
Docker-Compose dev database described below.

- `tests/integration/credit-repository.postgres.test.ts` — basic reservation, successful
  settlement, failure release, idempotency, **20 truly concurrent requests sharing one
  requestId** (collapses to exactly one reservation, zero unique-violations, zero rejected
  promises), **concurrent requests sharing a requestId with conflicting payloads** (exactly
  one wins, the other is rejected with `IdempotencyConflictError`, ledger never corrupted),
  the original 10-requests-different-requestId monthly-limit race (kept as a regression
  check), exact-limit boundary, and double-settlement guards (reject double-commit,
  double-release, release-after-commit, commit-after-release, a reserve→commit/release race;
  `reserved_credits` never goes negative).
  Plus a dedicated `reconciliation_pending` block: `markReconciliationPending` leaves
  `reserved_credits` untouched and records the error code, `reconcileCommit`/`reconcileRelease`
  correctly transition pending → completed/released, both are rejected on a record never
  marked pending, ordinary `commitCredits`/`releaseCredits` are rejected on a pending record,
  and re-`reserveCredits()`-ing a pending `requestId` is blocked (returns
  `reason: 'reconciliation_pending'`, creates no second reservation).
- `tests/integration/migrations.postgres.test.ts` — migration applies cleanly to an empty
  database, from empty (now asserting `study_days`/`reflections`/`reflection_status` **and**
  `study_day_comparisons`/`comparison_status` all exist alongside the credit tables), migration
  re-run is a no-op, foreign key / enum / `CHECK` / `UNIQUE` constraint enforcement at the
  database level for the credit tables (including the `reconciliation_pending`
  requires-`error_code` constraint), the daily-reflections tables (missing-`study_days`-FK
  rejection, bad `reflection_status` enum value, blank `display_name`/`content`, and a second
  `(study_date, participant_key)` row rejected as a unique violation), and the
  `study_day_comparisons` table (missing-`study_days`-FK rejection, bad `comparison_status`
  enum value, the `(status = 'completed') = (result IS NOT NULL)` `CHECK` enforced in both
  directions, and a duplicate `request_id` rejected as a unique violation), plus integer
  round-trip precision (no numeric/bigint string coercion, since the schema uses `integer`
  throughout).
- `tests/integration/reflections.postgres.test.ts` — `POST /api/v1/reflections/compare` driven
  through Fastify `inject()` with a **real** PostgreSQL-backed `CreditService` and a **mocked**
  Mindlogic HTTP layer: a successful comparison reserves and commits real rows, a non-retryable
  upstream failure releases the real reservation, and an already-exhausted real ledger blocks
  the Mindlogic call entirely.
- `tests/integration/study-days.postgres.test.ts` — the daily-reflections feature against a
  **real** PostgreSQL: two real distinct submitters both succeed and a genuine 3rd is rejected
  by real Postgres (not a mock), status/compare reflect real database state and compare calls
  the mocked Mindlogic client, fixed-time future-date-boundary rejection/acceptance, and —
  the test that actually proves the `FOR UPDATE` locking works under real contention — **~20
  truly concurrent `PUT` submissions for the same date with 20 distinct names**, asserted to
  collapse into exactly 2 `reflections` rows (18 rejected with `PARTICIPANT_LIMIT_REACHED`, 0
  unexpected errors, 0 deadlocks).
- `tests/integration/study-days-comparison.postgres.test.ts` — the study-day-comparison
  caching/locking feature (see [Study-day
  comparison](#study-day-comparison--caching-locking-crash-safety)) against a **real**
  PostgreSQL and a mocked Mindlogic HTTP layer — this is the suite that actually proves the
  two-phase claim/generate design is race-safe, not just correct against a single-threaded
  in-memory fake:
  - **The core concurrency proof**: **~20 truly concurrent `POST /compare` requests for the
    same date** (mixed callers, both real participants) against a mocked Mindlogic client that
    counts its own invocations, with an artificial delay widening the race window — asserts
    the mock was called **exactly once**, the `study_day_comparisons` row ends `'completed'`,
    and **exactly one** `credit_usage_records` row exists for the winning `request_id` (in
    fact, exactly one row total — no other reservation was created by the race at all).
  - Completed result persisted and re-queried with zero additional provider calls, identical
    result via `GET`.
  - A certain upstream failure (`401`) settles to `'failed'`; repeated plain `POST /compare`
    calls after that never re-call the provider, and the released `credit_usage_records` row
    for that first `request_id` is confirmed present and untouched.
  - `POST .../comparison/retry` on that `'failed'` row succeeds with a **new** `request_id`
    (confirmed distinct from the original in the real `study_day_comparisons` row), calls the
    provider a second time, and the **original** `credit_usage_records` row is confirmed still
    present with its original `'released'` status — plus a **~10-way concurrent retry** race on
    the same failed row (mocked provider call delayed to widen the window) asserted to call the
    provider **exactly once more**, not once per concurrent retry request.
  - A timeout (`AbortController` fires, no response) settles the row to
    `'reconciliation_pending'`; a subsequent `POST /compare` never re-calls the provider, and
    `POST .../comparison/retry` is rejected `409 RECONCILIATION_PENDING` with no provider call.
  - A `result` JSONB manually corrupted via raw SQL (bypassing the app entirely) is detected by
    `GET .../comparison`'s read-side validation — `500 { status: 'failed', code:
'CORRUPTED_RESULT' }`, never the malformed blob passed through as a valid `'completed'`
    response.
  - A log-capture test confirms reflection text, the article summary, and the full AI result
    JSON (`commonGround`/`differences`) never reach the logger across the whole lifecycle.
  - Every Mindlogic interaction in this file — including the concurrency race — goes through a
    mocked `fetchImpl`; nothing here ever calls the real Mindlogic API.

## Database / migrations

Schema lives in `src/db/schema.ts`; migrations are generated with Drizzle Kit into
`src/db/migrations/`.

```bash
pnpm db:generate   # regenerate SQL migrations from schema.ts (no DB connection needed)
pnpm db:migrate    # apply pending migrations to DATABASE_URL
pnpm db:studio     # open Drizzle Studio against DATABASE_URL
```

The initial migration (`src/db/migrations/0000_glorious_dark_beast.sql`), the follow-up
`0001_polite_warlock.sql` (adds the `provider_contract_check` credit-feature enum value),
`0002_watery_raider.sql` (adds the `study_days`/`reflections` tables and `reflection_status`
enum for the daily-reflections feature — see [Daily
reflections](#daily-reflections--study-day-based-comparison)), and
`0003_familiar_madame_web.sql` (adds the `study_day_comparisons` table and `comparison_status`
enum for the caching/locking feature — see [Study-day
comparison](#study-day-comparison--caching-locking-crash-safety)) are all applied automatically
to a throwaway container by every `pnpm test:integration` run, and have also been applied to
the local Docker Compose dev database (below). Run `pnpm db:migrate` yourself against any other
target once `DATABASE_URL` in `.env.local` points at it — **note**: on at least one Windows dev
shell, the `drizzle-kit migrate` CLI has been observed to hang indefinitely mid-run with no
error; when that happens, invoking `drizzle-orm/node-postgres/migrator`'s `migrate()` function
directly (a small standalone script pointed at the same `migrationsFolder`, the same call
`tests/integration/helpers/postgres-container.ts` already makes against the Testcontainers
database) applies the exact same migration files without hanging.

### Local development database (Docker Compose)

```bash
docker compose up -d      # start a persistent local PostgreSQL for `pnpm dev`
pnpm db:migrate            # apply migrations to it (once DATABASE_URL in .env.local points at it)
docker compose down        # stop it (add -v to also delete its data volume)
```

`docker-compose.yml` runs a single **development-only** `postgres:16-alpine` container:

- Host port **5433** (not 5432), so it never collides with a developer's own local PostgreSQL.
- Named volume `pairly_postgres_dev_data` for persistence across restarts.
- Default credentials (`pairly` / `pairly_dev_only_password` / db `pairly_english_dev`) are
  **dev-only placeholders committed on purpose** — not secrets, overridable via
  `DEV_DB_USER` / `DEV_DB_PASSWORD` / `DEV_DB_NAME` if you want different local values. Never
  reuse them anywhere that isn't this local container.
- Point `.env.local`'s `DATABASE_URL` at it, e.g.
  `postgres://pairly:pairly_dev_only_password@localhost:5433/pairly_english_dev`.

This is entirely separate from `pnpm test:integration`'s Testcontainers database: that one is
an ephemeral container on a random Docker-assigned port, created and destroyed per test run,
and never shares state or a port with this persistent dev container — both can run at once.

This migration has now been regenerated twice (originally `0000_puzzling_brood.sql`, then
`0000_salty_mariko_yashida.sql`, now `0000_glorious_dark_beast.sql` — this round added the
`reconciliation_pending` enum value and its `CHECK` constraint, described below). Since it had
never been applied anywhere real, the safest option remains folding changes into a fresh
initial migration rather than layering `ALTER TABLE`/`ALTER TYPE` migrations on top of a
schema no environment has ever run — once a migration has shipped to any real database, this
project will switch to additive migrations only.

### Schema

- **`credit_periods`** — one row per calendar month (`billing_month`, `'YYYY-MM'`, PK),
  tracking `committed_credits`, `reserved_credits`, `provider_reported_credits`, and an
  `exhausted` flag.
- **`credit_usage_records`** — one row per AI request (`request_id` UUID PK), with `feature`
  and `status` enums, token counts, and reserved/used credits. `status` is one of `reserved` /
  `completed` / `failed` / `released` / `reconciliation_pending` — see [Credit
  hard cap](#credit-hard-cap) below for the state machine.

Both tables also carry `CHECK` constraints requiring every credit/token count to be
non-negative (`>= 0`) — defense in depth confirmed by the integration suite's "check
constraint enforcement" tests, in addition to the application-level guarantees described
below. `credit_usage_records` additionally requires `error_code IS NOT NULL` whenever
`status = 'reconciliation_pending'`, so a pending row is never left with no recorded reason.

Deliberately **excluded** from `credit_usage_records`: essay/reflection text, full news
articles, transcripts, audio files, or any other original learner content. Only accounting
metadata is stored.

- **`study_days`** — one row per calendar date (`study_date`, `date`, PK), seeded by whichever
  participant submits first for that date; carries that day's `article_id`/`article_title`/
  `article_source_url`/`article_summary`.
- **`reflections`** — one row per participant per study day (`id` UUID PK), with `study_date`
  (FK → `study_days.study_date`), `participant_key` (normalized session name),
  `display_name`, `content`, a `reflection_status` enum (`submitted` only, this iteration never
  persists drafts server-side), and `submitted_at`/`updated_at`. `UNIQUE (study_date,
participant_key)` enforces at most one reflection per participant per day; `CHECK` constraints
  reject a blank `display_name` or `content`. See [Daily
  reflections](#daily-reflections--study-day-based-comparison) below.

Unlike `credit_usage_records`, `reflections` deliberately DOES store the original content — it
IS the record of what was submitted, not an accounting/ledger table. Only log lines are
restricted (see [Daily reflections](#daily-reflections--study-day-based-comparison)'s logging
discipline) — `participant_key`/`display_name`/`content` are never written to any log.

- **`study_day_comparisons`** — one row per calendar date (`study_date`, `date`, PK, FK →
  `study_days.study_date`), period — not one row per attempt (a retry `UPDATE`s the same row in
  place; see [Study-day comparison](#study-day-comparison--caching-locking-crash-safety)).
  Carries `request_id` (UUID, `UNIQUE`, shared with the matching `credit_usage_records` row for
  cross-referencing), a `comparison_status` enum (`processing` / `completed` / `failed` /
  `reconciliation_pending`), `model`, `input_fingerprint` (SHA-256 hex, irreversible), a
  nullable `result` JSONB, a nullable `error_code`, and `started_at`/`completed_at`/
  `updated_at`. `CHECK (status = 'completed') = (result IS NOT NULL)` enforces that completed
  rows always carry a result and non-completed rows never do. Like `credit_usage_records` (and
  unlike `reflections`), this table deliberately excludes reflection content — only the
  irreversible fingerprint and the AI-generated comparison result, never the inputs that
  produced it.

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
  releasing an already-settled (or pending) `requestId` throws (`InvalidCreditTransitionError`)
  instead of silently no-opping, and `reserved_credits` can never be double-decremented or
  driven negative — verified under real concurrent settlement attempts in the integration
  suite.
- 402 (credits exhausted) is never retried. 429/real 5xx (an actual received HTTP
  response) are retried up to `MAX_RETRY_ATTEMPTS` (`src/services/mindlogic/types.ts`) against
  the same reservation — this is now wired into
  `src/services/reflections/reflection-comparison-service.ts`, the reflection-comparison
  route's credit pipeline.

### Uncertain billing status: `reconciliation_pending`

A timeout, connection reset, or a response that gets cut off mid-stream means we genuinely do
not know whether Mindlogic received and billed the request. Releasing the reservation in that
case would be optimistic — if a real charge lands later, it would land against a budget we'd
already freed, silently letting real usage exceed the 5,000 cap. So the state machine has a
fifth status:

```text
reserved -> completed                 (commitCredits — the normal happy path)
reserved -> released                  (releaseCredits — a certain, clean failure)
reserved -> reconciliation_pending    (markReconciliationPending — billing status unknown)
reconciliation_pending -> completed   (reconcileCommit — operator confirmed it WAS billed)
reconciliation_pending -> released    (reconcileRelease — operator confirmed it was NOT billed)
```

Every other transition throws `InvalidCreditTransitionError`. `markReconciliationPending()`
deliberately does **not** touch `reserved_credits` — the reservation keeps counting against
the monthly budget, and a repeat call with the same `requestId` while it's pending returns
`{ ok: false, reason: 'reconciliation_pending' }` from `reserveCredits()` instead of
proceeding to call Mindlogic again (`src/services/reflections/reflection-comparison-service.ts`
returns HTTP `409 RECONCILIATION_PENDING` for this case — "this request could not be
confirmed and is being verified, do not resubmit it").

Which `MindlogicErrorCode`s go to which outcome (`src/services/mindlogic/types.ts`):

| Code                                                                                                                                                                                                                                                                                     | Certainty                                                                                                                                     | Outcome                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `invalid_request` (400) / `unauthorized` (401) / `credits_exhausted` (402) / `forbidden` (403) / `not_found` (404) / `request_timeout_response` (408) / `conflict` (409) / `validation_error` (422) / `rate_limited` (429) / `provider_error` (500–599) / `client_error` (any other 4xx) | A real HTTP response was received — every status code maps to a specific name; an unrecognized 4xx still gets `client_error`, never `unknown` | Release (402 additionally marks the month exhausted) |
| `connection_refused`                                                                                                                                                                                                                                                                     | TCP/DNS connection never came up (`ECONNREFUSED`/`ENOTFOUND`/`EAI_AGAIN`) — certain the request bytes were never sent                         | Release                                              |
| `timeout`                                                                                                                                                                                                                                                                                | Our own `AbortController` fired — no response, unknown whether Mindlogic received/processed it                                                | **`reconciliation_pending`**                         |
| `connection_reset`                                                                                                                                                                                                                                                                       | `ECONNRESET` — could have happened before or after the request was flushed                                                                    | **`reconciliation_pending`**                         |
| `incomplete_response`                                                                                                                                                                                                                                                                    | HTTP status/headers arrived (so the request definitely reached Mindlogic) but the body was truncated or malformed while streaming             | **`reconciliation_pending`**                         |
| `unknown`                                                                                                                                                                                                                                                                                | An unrecognized network-level failure — deliberately the conservative default rather than guessing                                            | **`reconciliation_pending`**                         |

`request_timeout_response` (HTTP 408) is a real response Mindlogic's own server sent, distinct
from our own client-side `timeout` (an `AbortController` firing with no response at all) — it
belongs in the received-response bucket, not the uncertain one.

No code is retryable except `rate_limited`/`provider_error` — see `RETRYABLE_ERROR_CODES`.
`connection_refused` is certain-safe-to-release but was deliberately left out of the retryable
set too; expanding retry scope to it wasn't part of this change.

Every non-2xx response also carries a `MindlogicErrorObservability` payload for safe logging
(`src/services/mindlogic/types.ts`): `providerErrorCode` (allow-listed short code from
`error.code`/`error.type`/`code`/`type`, never a free-text `message`), `providerRequestId`
(from a recognized response header), `contentType`, and `responseTopLevelKeys` (key names only,
never values). Routes spread this into their log line but never persist or return the raw
response body.

### Reconciliation (`src/services/credits/reconciliation.ts`)

`CreditService.reconcileCommit()`/`reconcileRelease()` give an operator a clear way to resolve
a pending reservation once they've checked Mindlogic's own `GET /credits/` — but **nothing in
this codebase calls them automatically**. No scheduler exists yet; this is a pure decision
function (`evaluateReconciliation()`) plus the two resolution methods, ready for a future
CLI/admin route/cron to drive.

`evaluateReconciliation({ providerUsedCredits, dbCommittedCredits, pendingReservations,
configuredMonthlyLimit })` compares Mindlogic's reported `monthly_allocated.used` against our
own `committed_credits` and never guesses:

- **`discrepancy <= 0`** (provider reports the same or less than we've already committed) —
  certain none of the pending reservations were billed; all are safe to
  `autoReleasableRequestIds`. A negative discrepancy is still flagged
  (`provider_reports_less_than_committed`, `requiresManualReview: true`) as worth investigating
  on its own, even though it doesn't implicate any pending request.
- **`discrepancy > 0` with no pending reservations** — `unexplained_discrepancy`: the gap
  doesn't resolve itself; nothing is auto-releasable.
- **`discrepancy > 0` exceeding the total of all pending reservations** —
  `discrepancy_exceeds_pending_reservations`: even resolving every pending record as billed
  wouldn't explain it — investigate before touching any of them.
- **`0 < discrepancy <= total pending`** — `ambiguous_pending_needs_manual_review`: the gap
  could be explained by any subset of the pending reservations; with more than one pending
  record, which one(s) cannot be determined from aggregate numbers alone, so **nothing is
  auto-releasable** even though the math "adds up". A single pending record gets a specific
  (still unconfirmed) suggestion in the verdict's `explanation`.

Every verdict also exposes `conservativeUsedBaseline` (`Math.max(providerUsed, dbCommitted)`)
and `conservativeRemainingCredits` computed from it — so gating new reservations during an
unresolved discrepancy always uses the stricter of the two sources, never optimistically the
lower one.

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

## Reflection comparison — first real AI feature

`POST /api/v1/reflections/compare` is the first endpoint that actually calls Mindlogic
(`createChatCompletion`, structured JSON output). It has now been exercised with a handful of
approved, one-shot real calls — see the status table above and
[Procedure for a one-time real smoke test](#procedure-for-a-one-time-real-smoke-test) for the
full history and guard files. Everything else (routing, validation, credit accounting, error
mapping) is still covered by the automated test suite against a mocked `fetchImpl`; see
[Endpoints implemented](#endpoints-implemented) below for the request/response contract and
[Mindlogic connectivity check](#mindlogic-connectivity-check) for the two GET endpoints that have
also been verified for real.

- **Request contract**: `{ article: { title, sourceUrl?, summary? }, mine: { displayName,
reflection }, partner: { displayName, reflection } }`. Validated with Zod
  (`src/services/reflections/schema.ts`): `article.title`/`displayName`/`reflection` required
  and rejected if blank/whitespace-only; `reflection` bounded to 50–6,000 characters (trimmed);
  `displayName` ≤ 80 chars; `sourceUrl` (if present) must be a valid URL. Overall body size is
  capped by Fastify's existing 100 KB `bodyLimit`. This is a length/blank check only, not a
  content filter — prompt-injection-style text in a reflection is valid input; the defense
  against it lives in the prompt (see below), not in validation.
- **Response contract**: `{ requestId, commonGround: { point, mine, partner }[], differences:
{ topic, mine: { stance, quote }, partner: { stance, quote } }[], topics: { question, reason,
difficulty: 'Intermediate' | 'Advanced' }[] (exactly 3) }`. Deliberately uses `mine`/`partner`
  — **not** the frontend mock's old `hj`/`js` field names, which were tied to specific display
  names rather than a generic role. See [Frontend contract alignment
  (resolved)](#frontend-contract-alignment-resolved) below.
- **Prompt** (`src/services/reflections/prompt.ts`): a fixed system prompt instructs the model
  to treat both reflections as untrusted data (never follow instructions embedded in them),
  never invent facts beyond the article/reflections, never distort either person's stance,
  ground every point in a quote, never rank/grade either person, produce exactly 3 English
  discussion questions, and output only JSON matching the schema. User content is passed as an
  explicitly labeled JSON data block, never string-interpolated into prose.
- **Structured output**: `response_format` is a strict JSON Schema
  (`REFLECTION_COMPARISON_RESPONSE_FORMAT`, `additionalProperties: false` throughout, `topics`
  pinned to `minItems`/`maxItems: 3`). The parsed response is **re-validated with Zod**
  independently (`reflectionComparisonSchema`) — the request-side schema alone isn't trusted.
  A response that fails `JSON.parse` (e.g. wrapped in ` ```json ` fences) or fails schema
  validation is treated as a genuine upstream error, **never silently patched or stripped**.
- **Model / token ceiling**: fixed per-feature in `src/services/mindlogic/feature-config.ts` —
  `gpt-5.4-mini`, `max_tokens: 1500`. The client cannot choose either. `claude-haiku-4-5-20251001`
  stays in `MODEL_CREDIT_RATES` (used by the `provider_contract_check` diagnostic feature) but
  is not used by `reflection_comparison` and is never an automatic fallback for it.
- **Input token estimate**: no real provider tokenizer is available server-side, so
  `src/services/mindlogic/token-estimate.ts` (`estimateChatRequestInputTokens`) uses raw UTF-8
  byte length as the token count — no "typical bytes-per-token" divisor. Byte-level BPE
  tokenizers (the family essentially every modern provider tokenizer, Claude's and OpenAI's
  alike, belongs to) can, for unusual byte sequences, produce tokens as short as a single byte,
  so `tokenCount <= byteCount` is the only universally safe invariant; a divisor tuned for
  English prose (an earlier version of this file used bytes÷3) is not a safe upper bound for
  CJK text, emoji, or mixed-script
  input. The estimate covers the **entire actual request payload** — every message's content
  (system + user, reused verbatim for the real call, so the estimate can never drift from what
  is actually sent) _and_ the serialized `response_format` JSON Schema, which also counts
  toward input tokens and is easy to forget — plus a small fixed per-message overhead and a
  minimum floor buffer. Reserved credits are always rounded up (`Math.ceil`, via the existing
  `calculateCredits()`). If real usage data is ever collected, the safety margin must not be
  lowered without deliberately re-verifying the CJK/emoji worst case stays safely reserved.
- **Reservation sizes** (computed against the real system prompt + `response_format` schema +
  `max_tokens: 1500`; verified in `reflection-comparison-service.test.ts`):

  | Scenario                                       | Estimated input tokens | Reserved credits | % of 5,000 cap |
  | ---------------------------------------------- | ---------------------- | ---------------- | -------------- |
  | Typical English request                        | ~4,600                 | ~13              | 0.26%          |
  | Maximum-length, ASCII/English                  | ~20,100                | ~28              | 0.56%          |
  | Maximum-length, Korean (worst-case bytes/char) | ~49,100                | ~57              | 1.14%          |
  | Maximum-length, emoji-heavy                    | ~37,100                | ~45              | 0.90%          |

  Even the worst realistic case (every field at its schema maximum, in Korean, the densest
  bytes-per-length-unit combination the length limits allow) reserves about 57 credits —
  comfortably under 500, let alone 5,000. No adjustment to `REFLECTION_MAX_LENGTH` or
  `max_tokens` was needed: this byte-length upper bound, while much more conservative than the
  divide-by-3 estimator it replaced, still leaves headroom for 80+ maximum-size requests in a
  single month.

- **Credit pipeline** (`src/services/reflections/reflection-comparison-service.ts`): validate →
  estimate input tokens → `reserveCredits()` → call Mindlogic (with retry) → validate
  response/usage → settle. Returns a discriminated-union outcome (`ok` /
  `limit_exceeded` / `provider_exhausted` / `upstream_failed` / `upstream_schema_error` /
  `reservation_exceeded` / `reconciliation_pending`) rather than throwing, so the route maps
  each case to a stable HTTP response.
  - Reservation rejected (limit exceeded, or a prior attempt with this requestId is still
    `reconciliation_pending`) → Mindlogic is **never called**.
  - A **certain**, clean failure before any Mindlogic response (a real HTTP 4xx/5xx, or
    `connection_refused` — the TCP/DNS connection never came up) → `releaseCredits()`.
  - An **uncertain** failure (`timeout`, `connection_reset`, `incomplete_response`, `unknown`)
    → held as `reconciliation_pending` instead — see [Uncertain billing
    status](#uncertain-billing-status-reconciliation_pending) above. Never released.
  - A response that arrives but fails schema validation or is missing `usage` → **settles to
    actual usage where known** (or the full reservation if `usage` itself is absent) rather
    than releasing it for free, since Mindlogic still did billable work.
  - `402` from Mindlogic → release + `markExhausted()` on our own ledger, never retried.
  - `429`/real `5xx` (an actual received HTTP response) → retried up to `MAX_RETRY_ATTEMPTS`
    (3 total attempts) against the **same** `requestId`/reservation — no new reservation per
    retry.
  - **Timeouts are never retried**, and are never released either (see above) — Mindlogic has
    no Idempotency-Key support, so if our own `AbortController` fires we cannot tell whether
    Mindlogic received and is processing (and will bill) the request; retrying could
    double-execute a real generative call, and releasing could later under-count a real charge
    past the 5,000 cap. Both risks point the same direction: hold, don't guess.
  - If actual usage (from Mindlogic's reported `usage`) ever exceeds the reservation — meaning
    the conservative estimator's own invariant was violated — the commit is **capped at the
    reserved amount**, the month is marked exhausted, and the AI result is **not** returned to
    the client, even though Mindlogic produced one: this is treated as a credit-accounting
    fault, not a normal response.
- **Logging**: only `requestId`, `feature`, `model`, estimated/actual token counts,
  reserved/actual credits, HTTP outcome, and duration are logged
  (`ReflectionComparisonAccounting` in the service, consumed by `src/routes/reflections.ts`).
  Reflection text, article body, display names, the API key, the `Authorization` header, and
  the model's raw response are never logged — verified by
  `tests/reflections.test.ts`'s log-capture test.
- **Auth gate** (`src/plugins/auth-gate.ts`): **updated by the section 10 tightening** (see
  [Study-day comparison](#study-day-comparison--caching-locking-crash-safety) above) — this
  route now uses `createDevTokenOnlyAuthGate()`, which accepts **only** the CLI smoke script's
  static `AI_DEV_ACCESS_TOKEN` bearer token, refused outright in production even if correct so a
  leaked static token alone can never reach a public deployment. A session cookie — even a
  valid one, from a real login, in any environment — is rejected here; nothing in the frontend
  calls this route anymore, so general browser traffic must use the date-based `study-days`
  endpoints instead. `createAuthGate()` (used elsewhere, e.g. historically by this same route)
  is untouched by this addition.
- **Rate limiting** (`@fastify/rate-limit`, registered with `global: false` in `src/app.ts`):
  `POST /api/v1/reflections/compare` is the only route that opts in
  (`REFLECTIONS_COMPARE_RATE_LIMIT` in `src/routes/reflections.ts`), capped at 10 requests per
  minute per caller (IP-keyed, the plugin's default). This is independent of, and much
  tighter than, the 5,000/month credit cap — it exists to blunt a buggy retry loop or a single
  caller hammering the route, not to budget spend. Exceeding it returns `429`.

### Frontend contract alignment (resolved)

An earlier round of this backend's work flagged three contract gaps against the frontend's
mock AI service; the frontend repository has since been updated to close all three (see its
own README / `src/services/api/` for the client-side half):

1. `AIService.compareReflections` now takes a single request object shaped like
   `CompareReflectionsRequest` (article + both display names + both reflections) instead of two
   bare strings, and `AIComparisonPage` no longer calls it with an empty partner reflection —
   it now waits for a real (mock-partner-service-sourced, for now) partner reflection before
   calling at all.
2. The frontend's `ComparisonResult` type now uses `mine`/`partner` field names, matching this
   server's response contract exactly instead of the old `hj`/`js` names.
3. `Article` (`mockNewsService.ts`) now carries an optional `sourceUrl`, matching this server's
   optional `article.sourceUrl`.

The frontend defines its own Zod schema for this contract (`src/services/api/schemas.ts` in
that repo) rather than trusting hand-written TypeScript types, so a future response-shape
change here would fail loudly on the frontend instead of silently mismatching.

## Daily reflections — study-day based comparison

Replaces the old client-supplied-partner-reflection flow (`POST /api/v1/reflections/compare`,
now deprecated — see above) with a server-owned notion of "today's study day": each participant
submits their own reflection against a date, the server matches up the two submissions itself,
and only then calls the same underlying `compareReflections()` AI comparison used by the old
route. The client body for the compare step carries no reflection text at all — the server
always reads both sides from the database, never from the caller.

### Identity (MVP — no real user accounts)

There is still no per-user accounts table (see [Authentication](#authentication)). A
participant's identity for this feature is derived entirely from the session cookie's `name`:

- `normalizeParticipantKey()` (`src/services/daily-reflections/participant-key.ts`) trims,
  Unicode-NFKC-normalizes, and lowercases the session name to produce a stable
  `participant_key` — this is what "the same person" means here.
- The original (trimmed, non-lowercased) session name is kept as `display_name` for UI.
- **The client is never trusted to supply the submitter's identity.** The request body schemas
  (`src/services/daily-reflections/schema.ts`) don't even define a name/participant field —
  they're `.strict()`, so a client that tries to add one gets `400 VALIDATION_ERROR`.
- **MVP limitation, stated plainly: logging in under a different name is treated as a different
  participant.** There is no way to prove two sessions belong to the same real person, so a
  typo'd or differently-cased-then-later-fixed display name can accidentally "use up" one of a
  study day's two participant slots. This is an accepted tradeoff for the shared-password MVP,
  not a bug to silently work around.

### Auth: `session-gate` vs. `auth-gate`

`POST /api/v1/reflections/compare` originally used `createAuthGate` (`src/plugins/auth-gate.ts`),
which only proves "some valid session exists" (plus a CLI dev-token escape hatch) — it never
exposes who the caller is (that route has since been tightened further to a dev-token-only
gate — see [Study-day comparison](#study-day-comparison--caching-locking-crash-safety)'s
section-10 note above, `createDevTokenOnlyAuthGate`). This feature needs to know WHO is
submitting, so all five study-days routes (the original three plus the two comparison routes
below) use a new, separate preHandler, `createSessionGate` (`src/plugins/session-gate.ts`):

- Verifies the session cookie only — **no CLI dev-token escape hatch**, since that token carries
  no name and this feature fundamentally needs one.
- On success, sets `request.session` (a new `FastifyRequest` decoration registered in
  `src/app.ts`) to the verified `{ name }` payload.
- On failure, sends the exact same `401 { error: { message, code: 'UNAUTHORIZED', requestId } }`
  envelope shape as `auth-gate.ts`.

`auth-gate.ts` itself is untouched — `/reflections/compare`'s auth behavior is unchanged.

### Concurrency: max 2 participants per study day

The core correctness requirement is that at most 2 distinct participants can submit for a given
`study_date`, even under real concurrent requests. `DrizzleDailyReflectionRepository
.submitReflection()` (`src/services/daily-reflections/daily-reflection-repository.ts`) enforces
this with the exact same pattern as `DrizzleCreditRepository.reserveCredits`
(`src/services/credits/credit-repository.ts`) — a single `db.transaction()`:

1. `INSERT INTO study_days ... ON CONFLICT (study_date) DO NOTHING` — guarantees the day's row
   exists (idempotent, Postgres-serialized on the PK). The first submitter's article info wins.
2. `SELECT ... FROM study_days WHERE study_date = $1 FOR UPDATE` — locks the one row every
   submission for this date must pass through, serializing all concurrent submissions.
3. While holding the lock: if the locked row's `article_id` doesn't match the submitted
   article's `id`, abort → `409 ARTICLE_MISMATCH`. No reflection row is written.
4. If a `reflections` row already exists for this exact `(study_date, participant_key)`, this is
   the same participant re-submitting: return that row's existing `submittedAt` idempotently
   (`200`, `submitted: true`). **Content is never overwritten** once submitted.
5. Otherwise, count existing `reflections` rows for this `study_date` (still inside the
   transaction, still holding the lock). If already 2, abort → `409 PARTICIPANT_LIMIT_REACHED`.
6. Otherwise, insert the new `reflections` row and return success.

The `FOR UPDATE` lock held across steps 2–6 is what makes this race-free — proven by
`tests/integration/study-days.postgres.test.ts`'s ~20-way concurrent `PUT` test (see
[Tests](#tests) below), not just by single-threaded mock assertions.

### `PUT /api/v1/study-days/:date/reflection`

Request:

```json
{
  "article": {
    "id": "string",
    "title": "string",
    "sourceUrl": "string | null",
    "summary": "string | null"
  },
  "reflection": "string"
}
```

Response `200`:

```json
{ "studyDate": "YYYY-MM-DD", "submitted": true, "submittedAt": "<ISO timestamp>" }
```

Errors: `400 VALIDATION_ERROR` (bad date, malformed body, reflection outside
`REFLECTION_MIN_LENGTH`/`REFLECTION_MAX_LENGTH`), `401 UNAUTHORIZED`,
`409 ARTICLE_MISMATCH`, `409 PARTICIPANT_LIMIT_REACHED`.

`:date` must be a real `YYYY-MM-DD` calendar date, no more than `STUDY_DAY_MAX_FUTURE_DAYS` days
(default `1`) ahead of "today" in Asia/Seoul — computed via
`Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', ... })`. No lower bound; arbitrarily old
past dates are always valid for the format itself. "Now" is injectable
(`StudyDaysRoutesOptions.now` in `src/routes/study-days.ts`) for fixed-time tests.

### `GET /api/v1/study-days/:date/status`

Response `200`:

```json
{
  "studyDate": "YYYY-MM-DD",
  "mine": { "submitted": true, "displayName": "..." },
  "partner": { "submitted": false, "displayName": null },
  "readyToCompare": false
}
```

`mine` is the row (if any) matching the caller's own `participant_key`; `partner` is the other
participant's row (if any). **`partner.content` is never included anywhere in this response** —
only `submitted`/`displayName`. `readyToCompare` is `true` only once exactly 2 distinct
participants have submitted.

### `POST /api/v1/study-days/:date/compare`

No request body content beyond the date in the URL — the server sources both sides from the
database itself, never from the caller. If fewer than 2 reflections exist for the date (covers
both "you haven't submitted" and "your partner hasn't submitted" — one error code for both, by
design), returns `409 PARTNER_NOT_READY` (unchanged from before). **Everything else about this
route was replaced** — it no longer calls `compareReflections()` unconditionally on every
request. It's now backed by the exactly-once, cached, crash-safe claim/generate design
described in full in [Study-day
comparison](#study-day-comparison--caching-locking-crash-safety) below: two concurrent clicks
collapse into exactly one Mindlogic call, a completed result is served from cache on every
subsequent request instead of re-calling the provider, and a `'failed'` comparison is never
silently retried by this route (only the new `POST .../comparison/retry` endpoint can retry
it). See that section for the exact response shapes for every state
(`processing`/`completed`/`failed`/`reconciliation_pending`), the two new companion endpoints
(`GET .../comparison`, `POST .../comparison/retry`), and the crash-safety/manual-recovery
procedure.

### Logging discipline (tested)

Allowed in logs for these three routes: `requestId`, `studyDate`, the participant key's
irreversible truncated hash (`hashForLogging()` — SHA-256, truncated to 12 hex chars, never
reversible back to the name), submit success/failure, `durationMs`. **Forbidden**: `displayName`,
reflection `content`, `article_summary`, the raw (unhashed) `participant_key`, the session
cookie value. `tests/study-days.test.ts` captures the Pino output stream and asserts none of the
forbidden values ever appear.

## Study-day comparison — caching, locking, crash-safety

Before this feature, `POST /api/v1/study-days/:date/compare` called `compareReflections()`
directly on **every** request: no locking, no caching, no persistence of the result. That meant
two browsers clicking "Compare" at the same instant could both call real Mindlogic (double
spend), a completed result was never reused (re-calling Mindlogic every time someone revisited
the page), and there was no way for two participants to see the same stored result. This
section replaces that with an exactly-once, cached, crash-safe design built around one new
table, `study_day_comparisons` (see [Schema](#schema) above), and a strict two-phase claim/generate
split so a database transaction is **never** held across the outbound Mindlogic call.

### The two-phase design

**Phase 1 — claim generation rights**
(`DrizzleComparisonRepository.claimGeneration()`,
`src/services/daily-reflections/comparison-repository.ts`). One short transaction, never held
across the Mindlogic call:

1. `SELECT ... FROM study_days WHERE study_date = $1 FOR UPDATE` — the same lock every
   reflection `PUT` already passes through. No row → `partner_not_ready` (there can't be 2
   reflections either).
2. Count `reflections` for the date. Not exactly 2 → `partner_not_ready`. Nothing is written.
3. Compute the input fingerprint (`computeInputFingerprint()`,
   `src/services/daily-reflections/comparison-fingerprint.ts`) — a SHA-256 hex digest of the
   day's `article.id` plus both reflections' `(participantKey, content)` pairs, **sorted by
   `participantKey`** before hashing so the fingerprint is identical regardless of which
   reflection happened to be read first. Pure, irreversible, independently unit-tested for the
   "order doesn't matter" property (`tests/comparison-fingerprint.test.ts`).
4. `SELECT ... FROM study_day_comparisons WHERE study_date = $1 FOR UPDATE` — may not exist yet;
   that's fine.
5. Branch on what's found:
   - **No row** → `INSERT` a fresh row (`status: 'processing'`, a new `request_id`, the computed
     `model`/`input_fingerprint`, `started_at: now`) — this transaction commits with the
     `INSERT`. Outcome **`claimed`**: this caller now owns provider-call rights.
   - **`completed`, fingerprint matches** → outcome **`cached`**: return the stored `result`
     as-is (re-validated — see "Read-side validation" below). No write.
   - **`completed`, fingerprint does NOT match** — defensive-only, effectively unreachable
     (reflections are immutable once submitted, so a date's fingerprint can never legitimately
     change): treated the same as "no row" — overwrite with a fresh `processing` claim and a new
     `request_id`, since the recorded result no longer corresponds to the current inputs.
   - **`processing`** → outcome **`in_progress`**. No write. This is what a losing concurrent
     request sees.
   - **`reconciliation_pending`** → outcome **`reconciliation_pending`**. No write. Never
     auto-retried.
   - **`failed`** → outcome **`failed`**. No write. `POST /compare` must **never** silently
     re-claim a `'failed'` row — only the explicit retry endpoint below may transition
     `failed → processing`, and only via its own separately-locked claim.

**Phase 2 — outside any transaction, only for the caller who got `claimed`.** Calls the
existing `compareReflections()` **unchanged**, with `deps.generateRequestId: () =>
claimedRequestId` (it already accepted this injectable) — so the exact same `request_id` lands
in both `study_day_comparisons` and `credit_usage_records`, the shared join key for manual
crash recovery (below). The outcome is then mapped to a `study_day_comparisons` update
(`ComparisonService.completeWithResult` / `.completeWithFailure` /
`.completeWithReconciliationPending`):

- `status: 'ok'` → the result is **re-validated** with `reflectionComparisonSchema.safeParse`
  a second time, immediately before the `UPDATE` (defense in depth — it was already validated
  once inside `compareReflections()`, but a storage boundary is never trusted on a single pass,
  matching this codebase's existing philosophy elsewhere) → `status: 'completed'`, `result` set,
  `completed_at`/`updated_at` set.
- `'limit_exceeded' | 'provider_exhausted' | 'upstream_failed' | 'upstream_schema_error' |
'reservation_exceeded'` → `status: 'failed'`, `error_code` set to the outcome's own upstream
  code where one exists (`upstream_failed`'s `MindlogicErrorCode`, e.g. `'rate_limited'`) or the
  outcome's status name itself otherwise (`'limit_exceeded'`, `'provider_exhausted'`,
  `'upstream_schema_error'`, `'reservation_exceeded'`).
- `'reconciliation_pending'` → `status: 'reconciliation_pending'`, `error_code` set to the
  upstream `MindlogicErrorCode`. Credit-side, `compareReflections()` has already called
  `markReconciliationPending()` itself — this only mirrors that state into
  `study_day_comparisons`, never duplicates the credit-side logic.

This "only the claimer calls the provider, and holds no lock while doing it" is what makes an
external AI call never block on (or be blocked by) a database transaction or row lock.

### `GET /api/v1/study-days/:date/comparison`

Read-only, session-gated, same date validation as the other study-days routes. Reflection text
**never** appears in any response here (this table doesn't store it — see `input_fingerprint`'s
note above).

| Stored state                | Response                                                                         |
| --------------------------- | -------------------------------------------------------------------------------- |
| No row                      | `200 { "status": "not_started" }`                                                |
| `processing`                | `200 { "status": "processing" }`                                                 |
| `completed` (valid)         | `200 { "status": "completed", "result": { commonGround, differences, topics } }` |
| `completed` (**corrupted**) | `500 { "status": "failed", "code": "CORRUPTED_RESULT" }`                         |
| `failed`                    | `200 { "status": "failed", "code": "<error_code>" }`                             |
| `reconciliation_pending`    | `200 { "status": "reconciliation_pending" }`                                     |

**Read-side validation**: a `completed` row's stored `result` JSONB is re-validated with
`reflectionComparisonSchema.safeParse` before being returned — independent of the write-side
check in Phase 2 above. If validation fails (a corrupted/tampered DB row — simulated in
`tests/integration/study-days-comparison.postgres.test.ts` via a raw SQL `UPDATE` that bypasses
the app entirely), the malformed blob is **never** passed through as if it were a valid
`'completed'` response; a warning is logged (allow-listed fields only, no content) and the
route responds `500 { status: 'failed', code: 'CORRUPTED_RESULT' }` instead — clearly
distinguishable from a legitimate `completed` response.
`reconciliation_pending`'s `error_code` is deliberately **not** exposed here (low-stakes either
way, but kept internally consistent with not leaking raw upstream detail).

### `POST /api/v1/study-days/:date/compare` (response shapes)

| Phase 1 / Phase 2 outcome                              | HTTP                          | Body                                                                                          |
| ------------------------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------- |
| `partner_not_ready`                                    | `409`                         | `{ error: { message, code: 'PARTNER_NOT_READY', requestId } }` (unchanged shape)              |
| `in_progress`                                          | `202`                         | `{ "status": "processing" }`                                                                  |
| `reconciliation_pending` (pre-existing stored state)   | `409`                         | `{ "status": "reconciliation_pending" }`                                                      |
| `failed` (pre-existing stored state — **not retried**) | `200`                         | `{ "status": "failed", "code": "<error_code>" }`                                              |
| `cached`                                               | `200`                         | `{ "status": "completed", "cached": true, "result": { commonGround, differences, topics } }`  |
| `cached`, but the stored result is corrupted           | `500`                         | `{ "status": "failed", "code": "CORRUPTED_RESULT" }`                                          |
| `claimed` → Phase 2 `ok`                               | `200`                         | `{ "status": "completed", "cached": false, "result": { commonGround, differences, topics } }` |
| `claimed` → Phase 2 failure                            | `402`/`502`/`500` (see below) | `{ "status": "failed" \| "reconciliation_pending", "code"?: "<error_code>" }`                 |

The `claimed` → Phase 2 failure HTTP status reuses the exact same decision table as the
deprecated `/reflections/compare` route
(`mapReflectionComparisonFailureToHttp()`, new export in
`src/services/reflections/http-mapping.ts`, additive — the original
`respondToReflectionComparisonOutcome()` used by `/reflections/compare` itself is untouched):
`limit_exceeded`/`provider_exhausted` → `402`, `upstream_failed`/`upstream_schema_error` →
`502`, `reservation_exceeded` → `500`, `reconciliation_pending` → `409`. Only the **body shape**
differs from the old route — `{ status, code }` (matching `GET .../comparison`'s vocabulary)
instead of the old flat `{ error: { message, code, requestId } }` envelope, since this is now
internally consistent with the cached/completed success shape above.

The pre-existing `failed` branch deliberately responds `200`, not an error status — it's
successfully reporting current state (a stored fact), the same way `GET .../comparison` does
for the identical case; it is **never** a trigger for Phase 2. A plain `POST /compare` on a
`failed` row is proven, across repeated calls, to never increment the provider's call count
(`tests/study-days-comparison.test.ts`, `tests/integration/study-days-comparison.postgres.test.ts`).

### `POST /api/v1/study-days/:date/comparison/retry`

Session-gated, same date validation. Only proceeds when the **current** stored status is
`failed`:

| Current stored state     | Response                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| No row / `not_started`   | `409 { error: { message, code: 'NOTHING_TO_RETRY', requestId } }`                                                                                |
| `processing`             | `202 { "status": "processing" }` — **not** an error; someone else's retry (or the original attempt) is still in flight                           |
| `completed`              | `409 { error: { message, code: 'ALREADY_COMPLETED', requestId } }` — never re-run                                                                |
| `reconciliation_pending` | `409 { error: { message, code: 'RECONCILIATION_PENDING', requestId } }` — never re-run; the hard "no retry while billing status is unknown" rule |
| `failed`                 | Claims retry rights (below), then runs Phase 2 exactly as `POST /compare`'s `claimed` branch — same response shapes as the table above           |

Claiming retry rights (`DrizzleComparisonRepository.claimRetry()`) is its own short,
separately-locked transaction: `SELECT ... FROM study_day_comparisons WHERE study_date = $1 FOR
UPDATE`, re-check the row is **still** `failed` while holding the lock (this is what makes
concurrent retries collapse into exactly one winner — proven by a ~10-way concurrent retry test
against real PostgreSQL), then atomically `UPDATE ... SET status = 'processing', request_id =
<new uuid>, started_at = now(), updated_at = now()`. Only the transaction that wins this
re-check proceeds; a concurrent loser sees the row already flipped to `processing` and returns
the same `202` as the `processing` row above. The winner then runs Phase 2 with the **new**
`request_id` — the old failed attempt's `request_id` (and its `credit_usage_records` row) is
**never** reused or touched; it stays exactly as it was, permanently, as the failure history
(confirmed in `tests/integration/study-days-comparison.postgres.test.ts` by re-querying that
row directly after a retry).

### Crash safety — no automatic takeover

If the server process dies mid-Phase-2, the row is stuck at `status: 'processing'` **forever**
— by design. Nothing in this codebase may automatically time it out or take it over (no
lease/TTL takeover logic exists anywhere, mirroring the credit ledger's
`reconciliation_pending` — see [Reconciliation](#reconciliation-srcservicescreditsreconciliationts)
above — which has the identical no-automatic-action philosophy).

- `ComparisonService.findStaleProcessing(olderThanMs)` /
  `ComparisonRepository.findStaleProcessing()` is a **purely informational, read-only** method
  an operator can call to find rows stuck at `processing` for longer than `olderThanMs`. It
  takes no action — it exists only so an operator (via a future `pnpm` script, or a one-off
  query/REPL call — this MVP does not require an automatic recovery scheduler) can find
  candidates to investigate.
- **Manual recovery procedure**: an operator who finds a stuck `processing` row cross-references
  `credit_usage_records` by the **same `request_id`** (the shared join key — see Phase 2 above)
  to determine whether Mindlogic was actually called/billed for that attempt, then manually
  decides:
  - Mark the row `failed` (via `ComparisonService.completeWithFailure(studyDate, requestId,
reason)`, or an equivalent direct `UPDATE`) if it's safe to let a human-initiated retry
    happen next — i.e. Mindlogic was confirmed **not** billed for this attempt (matching
    `credit_usage_records.status = 'released'`, or no credible sign of a completed call).
  - Mark the row `reconciliation_pending` (via
    `ComparisonService.completeWithReconciliationPending(studyDate, requestId, reason)`) if
    billing status is genuinely **unknown** — matching the credit ledger's own
    `reconciliation_pending` state for that `request_id`, or any ambiguity at all. This is the
    conservative default whenever in doubt.
  - This mirrors `scripts/credit-reconcile.ts`'s existing operator-run manual-recovery pattern
    for the credit ledger — no scheduler, every invocation a deliberate, human-triggered action.
- **The risk, stated explicitly**: a crash between "Mindlogic responded/billed" and "we
  persisted the result" could leave a real, billed generation that's invisible to both users —
  the AI result was generated and paid for, but never reached `study_day_comparisons`. This is
  exactly why no automatic action is taken here: an automatic timeout-based takeover could
  either re-call Mindlogic for an already-billed request (double spend) or silently discard a
  paid-for result, and there is no way to distinguish those cases without the same manual
  `credit_usage_records` cross-reference described above.

## Endpoints implemented

- `GET /health` — liveness only; no DB or Mindlogic dependency.
- `GET /ready` — checks env was loaded successfully and that PostgreSQL is reachable. Does
  **not** call Mindlogic.
- `GET /api/v1/usage` — returns a `UsageSummary` computed entirely from our own database
  ledger (`credit_periods` / `credit_usage_records`). No outbound Mindlogic call.
- `GET /api/v1/study-days/:date/article` — session-gated daily English news. It uses the
  server-fixed `daily_news → sonar-pro` feature configuration (the existing
  `reflection_comparison → gpt-5.4-mini` configuration is unchanged). Dates are interpreted in
  `Asia/Seoul`; a validated article is cached once in `daily_news_articles`, so both learners
  receive the same article id and content for the date. A PostgreSQL transaction-scoped advisory
  lock serializes misses and is automatically released on rollback, connection loss, or process
  death; the unique `study_date` constraint is the final backstop.

### Daily news generation and provider-contract limits

Daily news stores an original English-learning synthesis, not the source article or scraped body.
The provider prompt excludes sensational/graphic topics, prefers constructive stories published
within 72 hours, and requests exactly eight unique vocabulary words present in the generated
content (the learning target remains 6/8). Responses are parsed as JSON without code-fence or prose
repair, then checked with strict Zod schemas, length/HTML restrictions, publication-date checks,
and whole-word vocabulary matching.

Source trust is based on the parsed URL hostname, never the model's `sourceName`. The MVP exact
allowlist covers Reuters, AP, BBC, NPR, The Guardian, NASA, WHO, and UN hosts, plus official
`.gov`, `.gov.uk`, `.edu`, and `.ac.uk` hosts. HTTPS is mandatory; credentials, ports, fragments,
IP literals, localhost, and suffix tricks such as `reuters.com.evil.test` are rejected. The server
does not download or crawl the URL. Perplexity's official Sonar contract documents top-level
`citations`, `search_results`, and `usage`; saving fails closed unless the structured `sourceUrl`
exactly matches an allowlisted citation URL. `prompt.ts`'s system prompt spells this same allowlist
out to the model by name (derived from `source-url.ts`'s `DAILY_NEWS_SOURCE_ALLOWLIST`, so the two
can never drift apart) — without that, sonar-pro's real web search routinely cites outlets outside
the allowlist and every generation fails closed as `upstream_schema_error`, which is exactly what
production logs showed before this was added. A rejected completion's specific cause (missing
usage, invalid JSON, schema mismatch, topic mismatch, disallowed source, bad `publishedAt`) is
captured as a `reason` code and logged, rather than collapsing into one opaque outcome. Mindlogic
Gateway passthrough of those Perplexity extensions and JSON Schema support have not been verified
by a real `sonar-pro` POST, so deployment must run one separately approved smoke test before
enabling production traffic. There is no model fallback and no automatic retry.

Mindlogic does not publish a verified credit-unit conversion for `sonar-pro`. The ledger therefore
uses a deliberately conservative feature reservation rate of 3 input / 15 output credits per
1,000 tokens and a 2,400-token output ceiling. These are internal guard units, not asserted provider
prices. Actual token usage is settled through the existing ledger; uncertain transmission remains
`reconciliation_pending`, and operators reconcile it against GET `/credits/`. The existing 5,000
monthly-credit hard cap remains authoritative.

The success body is the article contract plus `id` and `cached`:
`{ id, studyDate, title, sourceName, sourceUrl, publishedAt, generatedAt, summary, content,
vocabulary: [{ word, definition, example }], cached }`. Apply generated migration
`src/db/migrations/0004_oval_nightcrawler.sql` with `pnpm db:migrate` during deployment, after a
backup and before directing traffic to the new endpoint. This repository's test procedure applies
it only to ephemeral Testcontainers PostgreSQL; it does not migrate Neon production.

- `POST /api/v1/auth/login`, `GET /api/v1/auth/session`, `POST /api/v1/auth/logout` — see
  [Authentication](#authentication).
- `POST /api/v1/reflections/compare` — **deprecated and restricted (section 10)**, superseded
  by `POST /api/v1/study-days/:date/compare` below. Nothing in the frontend calls this route
  anymore — kept only for the CLI smoke-test scripts (`scripts/mindlogic-smoke-test*.ts`), which
  always authenticate with the dev bearer token, never a session cookie. Its auth was tightened
  to match: `createDevTokenOnlyAuthGate()` (new export in `src/plugins/auth-gate.ts`, additive —
  the shared `createAuthGate()` used elsewhere is untouched) accepts **only** the dev bearer
  token, refused outright in production — a valid session cookie is rejected here even though
  it works everywhere else. Rate-limited to 10 requests/minute/caller.
  **Removal plan**: delete this route once the smoke-test scripts are migrated to call
  `POST /study-days/:date/compare` directly, or once it's no longer needed at all.
- `PUT /api/v1/study-days/:date/reflection`, `GET /api/v1/study-days/:date/status`,
  `POST /api/v1/study-days/:date/compare` — the daily-reflections feature; see [Daily
  reflections](#daily-reflections--study-day-based-comparison) below. All three require a valid
  session (no CLI dev-token escape hatch — see [Authentication](#authentication)).
- `GET /api/v1/study-days/:date/comparison`, `POST /api/v1/study-days/:date/comparison/retry` —
  the study-day-comparison caching/locking feature; see [Study-day
  comparison](#study-day-comparison--caching-locking-crash-safety) below. Both require a valid
  session, same as the three routes above.

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
  the corresponding test), and the login route never logs the submitted or shared password
  (see `tests/auth.test.ts`'s log-capture test).
- **Auth is real but intentionally minimal — see [Authentication](#authentication) for the
  full picture.** `/health`, `/ready`, and `/api/v1/usage` remain fully open (no user data,
  nothing billable). `/api/v1/reflections/compare` — the one route that can spend real money —
  requires a valid session in every environment.
- **This is a shared-password MVP, not multi-tenant auth, and that has a real limit even once
  deployed.** There is no per-user identity: holding _any_ valid session (from either learner)
  is sufficient to call the AI route, so nothing stops one logged-in browser from spending the
  other's share of the shared 5,000-credit/month budget. That's an accepted tradeoff for two
  people who already trust each other with one password, not a gap to "fix" without changing
  the product's whole approach to accounts. See [Next steps](#next-steps-not-yet-implemented).

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

## Procedure for a one-time real smoke test

`POST /api/v1/reflections/compare` calls real Mindlogic when this procedure is followed; every
other automated check uses a mocked `fetchImpl`. Each run is a separate, guarded, one-shot
script (`scripts/mindlogic-contract-check.ts`, `scripts/mindlogic-smoke-test.ts`, `-round2.ts`,
`-round3.ts` — each writes its own `.mindlogic-*-completed.json` guard file that blocks a second
run of that specific script) rather than a single reusable command, so that every real call stays
individually approved and auditable.

**Real runs so far** (guard files in the repo root; UTC timestamps):

| Script                                                                 | Guard file                                    | Completed (UTC)          | HTTP status |
| ---------------------------------------------------------------------- | --------------------------------------------- | ------------------------ | ----------- |
| `mindlogic-contract-check.ts` (bare, Haiku)                            | `.mindlogic-contract-check-completed.json`    | 2026-08-17T15:52:05.777Z | `200`       |
| `mindlogic-smoke-test.ts` (structured, Haiku, round 1)                 | `.mindlogic-smoke-test-completed.json`        | 2026-08-17T15:13:01.110Z | `409`\*     |
| `mindlogic-smoke-test-round2.ts` (structured, Haiku, round 2)          | `.mindlogic-smoke-test-round2-completed.json` | 2026-08-17T15:54:23.521Z | `502`\*     |
| `mindlogic-smoke-test-round3.ts` (structured, `gpt-5.4-mini`, round 3) | `.mindlogic-smoke-test-round3-completed.json` | 2026-08-17T16:17:33.729Z | `200`       |

\* Rounds 1 and 2 are this route's own mapped status (`reconciliation_pending`/upstream-error
handling — see [Uncertain billing status: `reconciliation_pending`](#uncertain-billing-status-reconciliation_pending)
and the `MindlogicErrorCode` outcome table under [Credit hard cap](#credit-hard-cap)), not
Mindlogic's raw response; Mindlogic itself rejected structured output for
`claude-haiku-4-5-20251001` with a `400`. That's why `reflection_comparison`'s configured model
was switched to `gpt-5.4-mini` (`src/services/mindlogic/feature-config.ts`) before round 3, which
then succeeded with a schema-valid `200`.

To run a **new** real smoke test (e.g. after a provider/model change), write a new numbered
script following the same pattern — reusing an existing guarded script will simply refuse to run
twice:

1. Confirm `.env.local` has a real `MINDLOGIC_API_KEY` (`pnpm mindlogic:check` should already
   pass — see [Mindlogic connectivity check](#mindlogic-connectivity-check)).
2. Start the app locally (`pnpm dev`) against either the Docker Compose dev database or a real
   PostgreSQL, with `AI_DEV_ACCESS_TOKEN` set.
3. `pnpm db:migrate` if the target database doesn't have the schema yet.
4. Send exactly one request:
   ```bash
   curl -X POST http://127.0.0.1:3001/api/v1/reflections/compare \
     -H "Authorization: Bearer $AI_DEV_ACCESS_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"article":{"title":"Smoke test article"},"mine":{"displayName":"A","reflection":"<50+ real characters>"},"partner":{"displayName":"B","reflection":"<50+ real characters>"}}'
   ```
5. Check the response is `200` with exactly 3 `topics`, and immediately check `GET
/api/v1/usage` to confirm `usedCredits` moved by a small, expected amount (not the full
   1,500-`max_tokens` reservation, and nowhere near 5,000).
6. If the response or request field names turn out to differ from what
   `src/services/mindlogic/types.ts` assumes, that's exactly what this smoke test exists to
   catch — fix the types before relying on the endpoint further.

## Manual browser verification (frontend ↔ backend wiring only, no real Mindlogic call)

Before the smoke test above (and before setting `VITE_USE_MOCK_AI=false` for real), confirm the
login → session → AI-route flow actually works end to end through a real browser, still against
a mocked Mindlogic client if you want to avoid spending credits, or against the real one once
you're ready:

1. `pnpm dev` here (backend) with `.env.local` set — `APP_SHARED_PASSWORD`, `SESSION_SECRET`,
   `FRONTEND_ORIGIN` matching the frontend's actual dev origin, and `DATABASE_URL` pointing at a
   running Postgres.
2. In the frontend repo, `pnpm dev` (the Vite dev server proxies `/api/*` to this server — see
   that repo's README).
3. In an actual browser tab, log in with any display name and `APP_SHARED_PASSWORD`. Confirm in
   the Network tab: the `Set-Cookie` response header on `POST /api/v1/auth/login` has `HttpOnly`
   (and, once served over https, `Secure`); no request anywhere sends an `Authorization` header;
   no CORS error appears in the console.
4. Refresh the page and confirm the session is restored (still logged in) via
   `GET /api/v1/auth/session`.
5. Walk the flow to `AIComparisonPage` and confirm `POST /api/v1/reflections/compare` succeeds.
6. Log out and confirm `GET /api/v1/auth/session` now reports `authenticated: false`, and that
   `POST /api/v1/reflections/compare` now returns `401`.

## Dictionary and My Vocabulary

All routes require the normal `pairly_session` cookie. The participant owner is derived only
from the verified session name (`trim` → NFKC → lowercase); request bodies cannot select an
owner, provider, or external URL.

- `GET /api/v1/dictionary/lookup?word=announce` returns up to three unique Wiktionary senses,
  a deterministic SHA-256 `senseId`, optional text pronunciation, and attribution. Lookup is
  limited to 60 requests/hour/IP, has a five-second provider timeout, does not follow redirects,
  and accepts only English words with optional internal apostrophes or hyphens.
- `GET /api/v1/vocabulary` lists the caller's saved items newest first.
- `PUT /api/v1/vocabulary/:normalizedWord` accepts `senseId` and optional paired `articleId` /
  `contextSentence`. Definitions are copied from the canonical server cache, never the client.
- `DELETE /api/v1/vocabulary/:normalizedWord` is idempotent and returns `204`.

The primary provider is [FreeDictionaryAPI.com](https://freedictionaryapi.com/), using
`GET /api/v1/entries/en/{word}` without an API key. The `translations` query param is
deliberately omitted: FreeDictionaryAPI's translation payload (every language it has data for,
not just Korean) can push a polysemous word's response well past the provider body cap, and
Korean word-level meanings are produced separately by Mindlogic (see below), not by this
provider. Each meaning's `koreanTranslations` array is therefore always empty; it is kept only
for lookup-response shape compatibility. No AI, Mindlogic, or paid translation API is used by
this provider call itself. Its published limit is 1,000 requests per hour per IP. Data comes
from Wiktionary under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
Wiktionary is community-maintained and may be incomplete or inaccurate; FreeDictionaryAPI.com
provides limited support and no guaranteed SLA. No production/commercial-use prohibition is
stated in the published API documentation, but attribution and share-alike obligations still
apply.

### Dictionary provider fallback

If the primary provider fails, `src/services/dictionary/fallback.ts` tries a secondary provider,
[dictionaryapi.dev](https://dictionaryapi.dev/) (`GET /api/v2/entries/en/{word}`, mapped in
`src/services/dictionary/secondary-provider.ts`), once — never both concurrently, never more than
one retry per provider, and never more than ~10s of total external wait (5s timeout per
provider). This was added after a production `emergency` lookup 504'd entirely at the primary
provider stage with no fallback available.

Fallback-eligible primary failures: rate limited (429), any 5xx, timeout, malformed/oversized
JSON, or a response that fails strict schema validation. **Not** fallback-eligible: an
unambiguous primary word-not-found (`200 OK` with an empty `entries` array — the one case
FreeDictionaryAPI's contract lets us tell apart from a real failure). FreeDictionaryAPI's
published OpenAPI spec documents only a `200` response for this endpoint — no dedicated 404 for
"word not found" — so any other non-2xx status (including an undocumented 404) is treated as an
ambiguous upstream failure and _is_ fallback-eligible, deliberately favoring fewer false "not
found" results over saving one extra call. dictionaryapi.dev, by contrast, follows the
well-known REST convention of a dedicated 404 for an unknown word, so a secondary-provider 404 is
treated as an authoritative `WORD_NOT_FOUND`.

If both providers fail, the caller sees the same public `DICTIONARY_PROVIDER_ERROR` contract as
before (never a per-provider raw code). Safe fields only are logged: feature, which provider
role failed (`primary`/`secondary`), failure stage, error category, HTTP status, latency,
whether fallback was attempted/succeeded, and cache-hit state — never the request URL, response
body, or any secret.

**Attribution is dynamic, not a fixed string.** dictionaryapi.dev's real license
(confirmed `CC BY-SA 3.0` for a live `emergency` lookup) differs from the primary provider's
(`CC BY-SA 4.0`), so every dictionary row stores its own `attribution` (provider name, source
name, license name, license URL) alongside `sourceUrl`, taken from whichever provider actually
produced it — never hardcoded, never copied from the other provider. The lookup and saved-
vocabulary response `source` field carries these validated values; the frontend renders
"Definitions from `{source.name}` via `{source.provider}`" / "Licensed under `{source.license}`"
from them rather than a hardcoded string.

Normalized entries are cached in PostgreSQL for 30 days regardless of which provider produced
them. A transaction-scoped advisory lock coalesces concurrent misses for the same word — the
lock wraps the whole primary→fallback attempt, so 20 concurrent misses still trigger only one
provider sequence. Expired data is refreshed; a stale entry may be served only when refresh
encounters rate limiting, timeout, or a temporary upstream failure from _both_ providers. Empty/
invalid responses are never cached. Provider response bodies are neither persisted nor logged.
Only the primary provider currently exposes no audio field; dictionaryapi.dev's is used
(HTTPS-only) when present, so `audioUrl` can now be non-null. This MVP does exact lookups only
and deliberately avoids guessed stemming/lemmatization. The provider boundary is
`src/services/dictionary/provider.ts` (primary) and `secondary-provider.ts` (fallback), with
`fallback.ts` as the single call site `DictionaryService` uses. A provider outage returns a
bounded upstream error (or stale cache when available); it never invokes Mindlogic or consumes
the credit ledger.

Dictionary cache rows carry an explicit schema version. Rows written before translation support
are version 1 and are refreshed once under the same advisory lock regardless of their remaining
TTL. Version 2 rows remain valid even when every `koreanTranslations` array is empty, so genuine
Wiktionary coverage gaps do not cause repeated provider calls. Saved vocabulary keeps its own
canonical translation _and_ attribution snapshot; later cache refreshes (possibly via the other
provider) cannot silently change an already-saved meaning's text or attribution. Adding the
fallback provider did not bump the cache schema version — `attribution` is a plain additive
column with a legacy-provider default (see migration `0008_lazy_madame_web`), and `senseId`
hashing was already, and remains, independent of provider/attribution data.

When article context is saved, the article UUID must exist in `daily_news_articles`; normalized
whitespace context must be present in its content, and the selected word must occur at an English
word boundary. The saved row references the article rather than duplicating article content.

## Next steps (not yet implemented)

- **A real smoke test of `POST /api/v1/reflections/compare`** — see
  [Procedure for a one-time real smoke test](#procedure-for-a-one-time-real-smoke-test) below.
  The `/chat/completions/` request/response shape (snake_case `max_tokens`,
  `response_format`, `usage.{prompt,completion}_tokens`, `choices[].message.content`) is
  inferred from the confirmed `/models/`/`/credits/` convention and general OpenAI-compatible
  norms — **never verified against the real endpoint**.
- **Per-user identity**, if the product ever needs to distinguish the two learners
  server-side (e.g. per-person rate limiting, per-person usage attribution, revoking one
  person's access without the other's). The current shared-password session
  (see [Authentication](#authentication)) is a deliberate MVP tradeoff, not an oversight — see
  the security-notes warning above.
- CI wiring for `pnpm test:integration` (Docker-in-CI) — not yet added; see
  [Tests](#tests) for the scripts this would run.
- **Automatic reconciliation.** `evaluateReconciliation()` (decision logic) and
  `reconcileCommit()`/`reconcileRelease()` (resolution) exist and are tested, but nothing calls
  Mindlogic's `GET /credits/`, feeds it the current month's `reconciliation_pending` rows, and
  acts on the verdict automatically — that wiring (a CLI, an admin route, or a scheduled job)
  is deliberately left for a follow-up, per this round's task. Until it exists, any
  `reconciliation_pending` row requires a human to run the reconciliation manually.
- ~~A real user sync/pairing backend.~~ **Implemented** — see [Daily
  reflections](#daily-reflections--study-day-based-comparison). `PUT
/api/v1/study-days/:date/reflection` / `GET .../status` / `POST .../compare` now let each
  participant submit their own reflection against a date and have the server itself match up
  the two submissions (max 2 distinct participants per day, race-safe under real concurrency —
  see the tests above), instead of the frontend's mock partner service supplying a canned
  partner reflection. The frontend still needs to switch `AIComparisonPage` from
  `mockPartnerService.getPartnerReflection` + `POST /reflections/compare` over to this new
  flow — that wiring is being done in parallel against this round's contract.
- **Still no real per-user accounts even for daily reflections.** As stated in [Daily
  reflections](#daily-reflections--study-day-based-comparison), identity is derived from the
  session's display name only — logging in under a different name is treated as a different
  participant. A real accounts system remains a separate, larger piece of work (see the
  "Per-user identity" bullet above).
