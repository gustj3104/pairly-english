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

**Status: no generative (POST) Mindlogic call has ever been made.** The Mindlogic client
(`src/services/mindlogic/client.ts`) is wired up and its two read-only GET endpoints have been
verified against the real gateway via `pnpm mindlogic:check` (see
[Mindlogic connectivity check](#mindlogic-connectivity-check) below) — but
`createChatCompletion` has never been called from anywhere, and no HTTP route calls any
Mindlogic method yet.

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

`src/config/env.ts` loads `.env.local` first and `.env` as a fallback (`.env.local` values
win); a plain `dotenv/config` import — the previous behavior — only reads `.env`, which this
project never uses, so real secrets in `.env.local` were silently never loaded. Fixed once
this was caught while wiring up the first real Mindlogic connectivity check.

`.env`, `.env.local`, and `.env.*.local` are git-ignored. Only `.env.example` is tracked.

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

### Fast unit tests (`pnpm test:run`, 137 tests, no Docker)

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

These run `CreditService`'s business rules against `InMemoryCreditRepository`
(`tests/helpers/in-memory-credit-repository.ts`) — a plain JS `Map`, **not** a stand-in for
PostgreSQL. It verifies `CreditService`'s logic, never PostgreSQL's transaction/locking
semantics — that's what the integration suite below is for.

### PostgreSQL integration tests (`pnpm test:integration`, 35 tests, requires Docker)

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
  database, migration re-run is a no-op, foreign key / enum / `CHECK` constraint enforcement
  at the database level (including the new `reconciliation_pending` requires-`error_code`
  constraint), and integer round-trip precision (no numeric/bigint string coercion, since the
  schema uses `integer` throughout).
- `tests/integration/reflections.postgres.test.ts` — `POST /api/v1/reflections/compare` driven
  through Fastify `inject()` with a **real** PostgreSQL-backed `CreditService` and a **mocked**
  Mindlogic HTTP layer: a successful comparison reserves and commits real rows, a non-retryable
  upstream failure releases the real reservation, and an already-exhausted real ledger blocks
  the Mindlogic call entirely.

## Database / migrations

Schema lives in `src/db/schema.ts`; migrations are generated with Drizzle Kit into
`src/db/migrations/`.

```bash
pnpm db:generate   # regenerate SQL migrations from schema.ts (no DB connection needed)
pnpm db:migrate    # apply pending migrations to DATABASE_URL
pnpm db:studio     # open Drizzle Studio against DATABASE_URL
```

The initial migration (`src/db/migrations/0000_glorious_dark_beast.sql`) has been generated
and is applied automatically to a throwaway container by every `pnpm test:integration` run,
but it has **not been applied to any persistent or remote database** — no such connection was
available while building this project. Run `pnpm db:migrate` yourself once `DATABASE_URL` in
`.env.local` points at a real, reachable PostgreSQL instance — for example, the local Docker
Compose database below.

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
- 402 (payment/credit exhausted) is never retried. 429/real 5xx (an actual received HTTP
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

| Code                                                                  | Certainty                                                                                                                         | Outcome                                              |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `unauthorized` / `payment_required` / `rate_limited` / `server_error` | A real HTTP response was received                                                                                                 | Release (402 additionally marks the month exhausted) |
| `connection_refused`                                                  | TCP/DNS connection never came up (`ECONNREFUSED`/`ENOTFOUND`/`EAI_AGAIN`) — certain the request bytes were never sent             | Release                                              |
| `timeout`                                                             | Our own `AbortController` fired — no response, unknown whether Mindlogic received/processed it                                    | **`reconciliation_pending`**                         |
| `connection_reset`                                                    | `ECONNRESET` — could have happened before or after the request was flushed                                                        | **`reconciliation_pending`**                         |
| `incomplete_response`                                                 | HTTP status/headers arrived (so the request definitely reached Mindlogic) but the body was truncated or malformed while streaming | **`reconciliation_pending`**                         |
| `unknown`                                                             | An unrecognized network failure — deliberately the conservative default rather than guessing                                      | **`reconciliation_pending`**                         |

No code is retryable except `rate_limited`/`server_error` — see `RETRYABLE_ERROR_CODES`.
`connection_refused` is certain-safe-to-release but was deliberately left out of the retryable
set too; expanding retry scope to it wasn't part of this change.

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
(`createChatCompletion`, structured JSON output). **No real call to it has been made** — every
test uses a mocked `fetchImpl`; see [Endpoints implemented](#endpoints-implemented) below for
the request/response contract and [Mindlogic connectivity check](#mindlogic-connectivity-check)
for the two GET endpoints that have been verified for real.

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
  — **not** the frontend mock's `hj`/`js` field names, which are tied to specific display names
  rather than a generic role. See [Differences from the current frontend
  contract](#differences-from-the-current-frontend-contract) below.
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
  `claude-haiku-4-5-20251001`, `max_tokens: 1500`. The client cannot choose either.
- **Input token estimate**: no real Claude tokenizer is available, so
  `src/services/mindlogic/token-estimate.ts` (`estimateChatRequestInputTokens`) uses raw UTF-8
  byte length as the token count — no "typical bytes-per-token" divisor. Byte-level BPE
  tokenizers (the family Claude's almost certainly belongs to) can, for unusual byte
  sequences, produce tokens as short as a single byte, so `tokenCount <= byteCount` is the
  only universally safe invariant; a divisor tuned for English prose (an earlier version of
  this file used bytes÷3) is not a safe upper bound for CJK text, emoji, or mixed-script
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
- **Pre-auth gate** (`src/plugins/dev-ai-gate.ts`): real authentication doesn't exist yet, so
  this (and any future AI route) fails closed two ways — **always 404 in production**
  regardless of any token, and in development/test requires
  `Authorization: Bearer <AI_DEV_ACCESS_TOKEN>` matching a server-only env var; if that var
  isn't set at all, the route refuses with 503 rather than defaulting to open access. The token
  is never bundled into the frontend build.

### Differences from the current frontend contract

The frontend mock (`mockAIService.compareReflections`) and `AIComparisonPage` currently:

1. Take two bare reflection strings (no article, no display names) —
   `compareReflections(myReflection: string, partnerReflection: string)`. The server's request
   shape is richer (article + both display names) and does not match this signature; the
   frontend page currently even calls it with an **empty partner reflection**
   (`aiService.compareReflections(state.reflection.body, '')`), which is itself an existing gap
   unrelated to this work.
2. Use `hj`/`js` as the two-person field names in `ComparisonResult`, tied to specific display
   names rather than a generic role. The server intentionally uses `mine`/`partner` instead —
   per this task's own instruction not to carry `hj`/`js` into the server API.
3. `Article` (`mockNewsService.ts`) has no `sourceUrl` field — the server's optional
   `article.sourceUrl` has no current frontend source.

None of this was changed in the frontend repository (read-only per this task). Wiring the
frontend to this endpoint will need: an `AIService` implementation that builds
`CompareReflectionsRequest` from article + both reflections + both display names, and a
mapping from `{ mine, partner }` back to whatever field names `AIComparisonPage` ends up using.

## Endpoints implemented

- `GET /health` — liveness only; no DB or Mindlogic dependency.
- `GET /ready` — checks env was loaded successfully and that PostgreSQL is reachable. Does
  **not** call Mindlogic.
- `GET /api/v1/usage` — returns a `UsageSummary` computed entirely from our own database
  ledger (`credit_periods` / `credit_usage_records`). No outbound Mindlogic call.
- `POST /api/v1/reflections/compare` — the reflection-comparison AI feature described above.
  Gated by the dev pre-auth token; disabled entirely in production.

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
- **No real authentication/authorization exists yet.** `/health`, `/ready`, and
  `/api/v1/usage` remain fully open. `/api/v1/reflections/compare` — the one route that can
  spend real money — has the temporary fail-closed dev-token gate described above; every
  future AI route should reuse `createDevAiGate` until real auth lands.

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

`POST /api/v1/reflections/compare` has never made a real Mindlogic call — everything above was
verified with a mocked `fetchImpl`. Before relying on it, run one real call deliberately:

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

This deliberately was **not** run as part of this work — the task explicitly required stopping
before any real generative call, pending separate approval.

## Next steps (not yet implemented)

- **A real smoke test of `POST /api/v1/reflections/compare`** — see
  [Procedure for a one-time real smoke test](#procedure-for-a-one-time-real-smoke-test) below.
  The `/chat/completions/` request/response shape (snake_case `max_tokens`,
  `response_format`, `usage.{prompt,completion}_tokens`, `choices[].message.content`) is
  inferred from the confirmed `/models/`/`/credits/` convention and general OpenAI-compatible
  norms — **never verified against the real endpoint**.
- Real authentication/authorization for `/api/v1/*`, replacing the temporary dev-token gate.
- CI wiring for `pnpm test:integration` (Docker-in-CI) — not yet added; see
  [Tests](#tests) for the scripts this would run.
- **Automatic reconciliation.** `evaluateReconciliation()` (decision logic) and
  `reconcileCommit()`/`reconcileRelease()` (resolution) exist and are tested, but nothing calls
  Mindlogic's `GET /credits/`, feeds it the current month's `reconciliation_pending` rows, and
  acts on the verdict automatically — that wiring (a CLI, an admin route, or a scheduled job)
  is deliberately left for a follow-up, per this round's task. Until it exists, any
  `reconciliation_pending` row requires a human to run the reconciliation manually.
- Decide with the frontend team how to reconcile `mine`/`partner` (this server) against
  `hj`/`js` (current frontend mock) and the missing article/display-name fields in the current
  `compareReflections(myReflection, partnerReflection)` call signature — see
  [Differences from the current frontend contract](#differences-from-the-current-frontend-contract).
