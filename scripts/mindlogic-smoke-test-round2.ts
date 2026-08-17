import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { db, pool } from '../src/db/client.js';
import { creditPeriods, creditUsageRecords } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { reflectionComparisonSchema } from '../src/services/reflections/schema.js';
import { getBillingMonth } from '../src/services/credits/billing-period.js';

/**
 * Round 2 of the approved real smoke test of POST /api/v1/reflections/compare
 * (structured output, response_format JSON Schema). This is a SEPARATE
 * script with its own guard file — the round 1 guard
 * (.mindlogic-smoke-test-completed.json, from the first, ambiguous
 * reconciliation_pending attempt) is never deleted or reused; it stays as
 * a permanent record of that earlier attempt. This script is only ever run
 * after scripts/mindlogic-contract-check.ts (the bare-messages contract
 * check) has already succeeded.
 *
 * Boots the real app (real CreditService/DrizzleCreditRepository against
 * DATABASE_URL, real MindlogicClient against MINDLOGIC_API_KEY) and makes
 * AT MOST ONE generative POST through the actual route + credit pipeline
 * — never calls Mindlogic directly. Every precondition below must pass or
 * the script stops before that POST. A guard file blocks a second run of
 * THIS script specifically.
 *
 * Run with: MINDLOGIC_MAX_RETRIES=0 pnpm exec tsx scripts/mindlogic-smoke-test-round2.ts
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const GUARD_FILE = resolve(__dirname, '../.mindlogic-smoke-test-round2-completed.json');

// Same approved test article/reflections as round 1 — deliberately
// unchanged, so this is a clean retry of the same structured-output
// contract, not a new test case.
const TEST_BODY = {
  article: {
    title: 'Should AI Be Used as a Daily Learning Partner?',
    summary:
      'The article discusses the benefits and risks of using artificial intelligence in everyday education.',
  },
  mine: {
    displayName: 'Learner A',
    reflection:
      'I think AI can be a useful learning partner because it gives immediate feedback and allows students to practice without feeling embarrassed. However, students should still verify important information and should not depend on AI for every decision.',
  },
  partner: {
    displayName: 'Learner B',
    reflection:
      'AI makes learning more convenient, but I am concerned that students may stop thinking independently when answers are always available. I believe teachers and conversations with other people should remain more important than automated feedback.',
  },
};

const responseSchema = reflectionComparisonSchema.extend({ requestId: z.string() });

function fail(message: string): never {
  console.error(`\n[SMOKE TEST ROUND 2 ABORTED — no generative POST was made] ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  // --- Guard: refuse a second run of THIS script outright ---
  if (existsSync(GUARD_FILE)) {
    const record: unknown = JSON.parse(readFileSync(GUARD_FILE, 'utf8'));
    console.error('\n[SMOKE TEST ROUND 2 BLOCKED] A completed run already exists:');
    console.error(JSON.stringify(record, null, 2));
    console.error(`\nDelete ${GUARD_FILE} manually if a genuine re-run is intended.`);
    process.exit(1);
  }

  console.log('=== Preconditions ===');

  // --- Precondition: MINDLOGIC_MAX_RETRIES=0 was actually set for this run ---
  if (env.MINDLOGIC_MAX_RETRIES !== 0) {
    fail(
      `MINDLOGIC_MAX_RETRIES must be 0 for this smoke test (got ${String(env.MINDLOGIC_MAX_RETRIES)}). Run: MINDLOGIC_MAX_RETRIES=0 pnpm exec tsx scripts/mindlogic-smoke-test-round2.ts`,
    );
  }
  console.log('MINDLOGIC_MAX_RETRIES=0: confirmed');

  // --- Precondition: required secrets present (booleans only, never printed) ---
  const hasApiKey = env.MINDLOGIC_API_KEY.length > 0;
  const hasDevToken = Boolean(env.AI_DEV_ACCESS_TOKEN && env.AI_DEV_ACCESS_TOKEN.length > 0);
  console.log('MINDLOGIC_API_KEY present:', hasApiKey);
  console.log('AI_DEV_ACCESS_TOKEN present:', hasDevToken);
  if (!hasApiKey || !hasDevToken) {
    fail('Required secret(s) missing from env.');
  }

  const app = buildApp();
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  console.log('dev server listening at', address);

  try {
    // --- Precondition: /ready, via a real HTTP request to the running server ---
    const readyResponse = await fetch(`${address}/ready`);
    const readyBody: unknown = await readyResponse.json();
    console.log('/ready status:', readyResponse.status, readyBody);
    if (readyResponse.status !== 200) {
      fail('/ready did not return 200 — database not reachable.');
    }

    // --- Precondition: Mindlogic credits before the call ---
    // Unlike round 1's script, this does NOT require used===0/remaining===5000
    // — this round intentionally runs after scripts/mindlogic-contract-check.ts
    // already consumed a small, known amount. Instead: the quota must still be
    // the configured 5000, the provider's own used+remaining must add up
    // (internal consistency), and used must still be small (< 5 credits) —
    // catching any *unexpected* additional consumption between round 1 and
    // this call, without assuming a pristine, zero-usage month.
    const before = await app.mindlogicClient.getCreditsWithStatus();
    console.log('Mindlogic /credits/ before:', {
      status: before.status,
      used: before.credits.monthly_allocated.used,
      remaining: before.credits.monthly_allocated.remaining,
      quota: before.credits.monthly_allocated.quota,
    });
    if (before.status !== 200) {
      fail('GET /credits/ did not return 200 before the call.');
    }
    if (before.credits.monthly_allocated.quota !== 5000) {
      fail(`monthly_allocated.quota must be 5000 (was ${before.credits.monthly_allocated.quota}).`);
    }
    const reportedTotal =
      before.credits.monthly_allocated.used + before.credits.monthly_allocated.remaining;
    if (Math.abs(reportedTotal - before.credits.monthly_allocated.quota) > 0.01) {
      fail(
        `monthly_allocated.used + remaining (${reportedTotal}) does not match quota (${before.credits.monthly_allocated.quota}).`,
      );
    }
    if (before.credits.monthly_allocated.used >= 5) {
      fail(
        `monthly_allocated.used is unexpectedly high before round 2 (${before.credits.monthly_allocated.used}) — investigate before proceeding.`,
      );
    }

    console.log(
      '\nAll preconditions satisfied. Making exactly one real POST /api/v1/reflections/compare...\n',
    );

    // --- The one approved generative call, through the real route + credit pipeline ---
    const startedAt = Date.now();
    const response = await fetch(`${address}/api/v1/reflections/compare`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.AI_DEV_ACCESS_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(TEST_BODY),
    });
    const durationMs = Date.now() - startedAt;
    const body: unknown = await response.json();
    const requestId =
      typeof body === 'object' && body !== null && 'requestId' in body
        ? String((body as { requestId: unknown }).requestId)
        : typeof body === 'object' && body !== null && 'error' in body
          ? String((body as { error: { requestId?: unknown } }).error?.requestId ?? 'unknown')
          : 'unknown';

    console.log('=== Result ===');
    console.log('HTTP status:', response.status);
    console.log('requestId:', requestId);
    console.log('duration (ms):', durationMs);

    // Immediately record the guard file — before any further processing —
    // so a crash below still blocks a second real POST from this script.
    writeFileSync(
      GUARD_FILE,
      JSON.stringify(
        {
          completedAt: new Date().toISOString(),
          requestId,
          httpStatus: response.status,
        },
        null,
        2,
      ),
    );

    if (response.status === 200) {
      const parsed = responseSchema.safeParse(body);
      console.log('Zod schema validation:', parsed.success ? 'PASSED' : 'FAILED');
      if (parsed.success) {
        console.log('topics count:', parsed.data.topics.length);
        console.log(
          'uses mine/partner (not hj/js):',
          'mine' in parsed.data.commonGround[0]! && 'partner' in parsed.data.commonGround[0]!,
        );
      } else {
        console.log(
          'Zod issues (paths only):',
          parsed.error.issues.map((i) => i.path.join('.')),
        );
      }
    } else if (typeof body === 'object' && body !== null && 'error' in body) {
      const errorBody = (body as { error: { code?: unknown; message?: unknown } }).error;
      console.log('error code:', errorBody?.code);
      console.log('error message:', errorBody?.message);
    }

    // --- DB ledger verification ---
    const billingMonth = getBillingMonth();
    const [usageRecord] = await db
      .select()
      .from(creditUsageRecords)
      .where(eq(creditUsageRecords.requestId, requestId));
    const [period] = await db
      .select()
      .from(creditPeriods)
      .where(eq(creditPeriods.billingMonth, billingMonth));

    console.log('\n=== DB ledger ===');
    console.log('usage record status:', usageRecord?.status ?? '(not found)');
    console.log('usage record creditsReserved:', usageRecord?.creditsReserved ?? null);
    console.log('usage record creditsUsed:', usageRecord?.creditsUsed ?? null);
    console.log('period committedCredits:', period?.committedCredits ?? null);
    console.log('period reservedCredits:', period?.reservedCredits ?? null);

    // --- Mindlogic credits after the call ---
    const after = await app.mindlogicClient.getCreditsWithStatus();
    console.log('\n=== Mindlogic /credits/ after ===');
    console.log('status:', after.status);
    console.log('used:', after.credits.monthly_allocated.used);
    console.log('remaining:', after.credits.monthly_allocated.remaining);
    console.log(
      'used delta:',
      after.credits.monthly_allocated.used - before.credits.monthly_allocated.used,
    );
  } finally {
    await app.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('\n[SMOKE TEST ROUND 2 ERROR]', error instanceof Error ? error.message : error);
  process.exit(1);
});
