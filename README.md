# figma-make-app (Pairly English frontend)

React + Vite + Tailwind CSS frontend for Pairly English. Talks to the `pairly-english-server`
backend — see [Backend integration](#backend-integration) below.

This is a **separate git repository** from the backend (a sibling directory,
`pairly-english-server`), not a subdirectory of it. See that repository's own README for
everything backend-side (credit ledger, Mindlogic integration, session/auth internals).

For the Figma Make scaffold itself (dev server, project structure, styling conventions), see
[AGENTS.md](./AGENTS.md).

## Authentication (MVP)

No accounts, no email, no invite codes. Both learners log in with their own display name plus
one shared password (set server-side as `APP_SHARED_PASSWORD` — see the backend's README). The
name is a display value only, never an authorization check — two people can use the same name.

- `LandingPage` (`src/pages/LandingPage.tsx`) owns the whole flow: on mount it calls
  `GET /api/auth/session` to restore an existing session (so a page refresh doesn't force a
  re-login); if that comes back unauthenticated but a name was already saved locally, it shows
  a "session expired" notice instead of the plain first-visit hero.
- Login (`POST /api/auth/login`) sets an HttpOnly session cookie server-side — this app never
  sees or stores the password anywhere past the one request that submits it (not in
  `localStorage`, not held in state longer than the request needs).
- `TopNav` has the sign-out control, calling `POST /api/auth/logout` and then clearing all
  local learning state (`useLearning().reset()`) before returning to the landing page.
- `POST /api/reflections/compare` requires a valid session; a `401` there is treated as
  "session expired" and sends the user back to `LandingPage` to log in again
  (`AIComparisonPage`'s `session_expired` status).
- There is **no mock mode for auth** — `src/services/api/authService.ts` always calls the real
  backend. (Contrast with AI features, which have an explicit `VITE_USE_MOCK_AI` opt-in — see
  below.) Tests mock `authService`'s functions directly (`vi.mock('../services/api/authService')`)
  rather than relying on an env flag, so they never depend on a running backend.

## Backend integration

- **API client** (`src/services/api/`): `client.ts` always calls relative `/api/...` paths with
  `credentials: 'include'` — **never an absolute backend URL**, and never an API key or bearer
  token of any kind. `schemas.ts` defines the Zod contract for both the reflection-comparison
  and auth endpoints, mirroring the backend's own schemas; every response is re-validated
  against them rather than trusted as-typed.
- **Dev proxy** (`vite.config.ts`, `server.proxy['/api']`): forwards `/api/*` to
  `http://localhost:3001` (override with `BACKEND_URL` if the backend runs elsewhere). This
  makes the browser's requests same-origin from its own point of view — no CORS preflight, and
  the backend's session cookie (which sets no explicit `Domain`) is scoped correctly without
  any `SameSite=None`/cross-site cookie complexity.
- **Production (planned, not yet implemented):** the same same-origin-proxy shape via a Vercel
  rewrite of `/api/*` to the Render-hosted backend (`vercel.json`'s `rewrites`, pointing at the
  deployed `pairly-english-server` URL). Not yet created — this repo has no Vercel or Render
  config yet; that's a separate, explicitly-approved deployment step. Whoever sets it up needs:
  the backend's deployed HTTPS URL, and the backend's `FRONTEND_ORIGIN` env var updated to the
  deployed frontend origin (CORS is still origin-locked even though the proxy sidesteps it for
  the browser's own requests).
- **AI mock mode**: `VITE_USE_MOCK_AI=true` switches `aiService` to `mockAIService`; unset or
  any other value calls the real backend. No automatic fallback to mock data on a failed real
  call — see `src/pages/AIComparisonPage.tsx`'s explicit error states
  (`credit_limit_exceeded` / `reconciliation_pending` / `rate_limited` / `backend_unavailable` /
  `invalid_response` / `session_expired` / generic `error`).
- **Partner reflection (MVP)**: sourced from `src/services/mockPartnerService.ts`
  (`getPartnerReflection`), not a real second user's submission — there is no user-sync backend
  yet. `AIComparisonPage` refuses to call the AI route with an empty partner reflection and
  sends the learner back to the waiting page instead.

## Development Server

A Vite development server is **already running** on `$PORT` (default 8443). You don't need to
start it manually.

## Environment variables

Copy `.env.example` to `.env.local` and fill in real values. Every var here is `VITE_`-prefixed
and therefore bundled into the browser build — **never** put a secret (Mindlogic API key, the
backend's shared password or session secret, its CLI dev-auth token) in a `VITE_*` var; those
live only in the backend repo's own `.env.local`. There is no `VITE_API_BASE_URL` — see
[Backend integration](#backend-integration) above for why.

## Tests

```bash
pnpm test:run    # Vitest unit/component tests — hermetic, no backend needed (see .env.test)
pnpm test:e2e    # Playwright — auth endpoints mocked at the network layer (see e2e/happy-path.spec.ts);
                 # everything else already goes through this app's own mock services
pnpm exec tsc --noEmit
pnpm build
```

Neither suite calls the real backend or the real Mindlogic API.
