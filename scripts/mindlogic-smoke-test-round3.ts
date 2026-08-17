import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Writable } from 'node:stream';
import { z } from 'zod';
import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { db, pool } from '../src/db/client.js';
import { creditPeriods, creditUsageRecords } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { reflectionComparisonSchema } from '../src/services/reflections/schema.js';
import { getBillingMonth } from '../src/services/credits/billing-period.js';
import { getFeatureModelConfig } from '../src/services/mindlogic/feature-config.js';

/**
 * Round 3 of the approved real smoke test of POST /api/v1/reflections/compare
 * (structured output), now using gpt-5.4-mini per the operator's env change.
 * A SEPARATE script with its own guard file — round 1 and round 2 guards are
 * never deleted or reused; they stay as permanent records of those earlier
 * attempts. Preconditions here are exact-value checks (the ledger state left
 * behind by rounds 1-2), not the generic "pristine month" checks round 1's
 * script used.
 *
 * Boots the real app (real CreditService/DrizzleCreditRepository against
 * DATABASE_URL, real MindlogicClient against MINDLOGIC_API_KEY) and makes
 * AT MOST ONE generative POST through the actual route + credit pipeline.
 * Captures the app's own structured log output in memory (never printed
 * raw) so the safe upstream observability fields (upstreamStatus, code,
 * and the FastAPI-style detail type/loc summary — never msg/input/ctx) can
 * be reported in isolation from Fastify's interleaved request-lifecycle
 * logging.
 *
 * Run with: MINDLOGIC_MAX_RETRIES=0 pnpm exec tsx scripts/mindlogic-smoke-test-round3.ts
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const GUARD_FILE = resolve(__dirname, '../.mindlogic-smoke-test-round3-completed.json');

const EXPECTED_PROVIDER_USED = 0.044;
const EXPECTED_PROVIDER_REMAINING = 4999.96;
const FLOAT_EPSILON = 0.0005;

// Same approved test article/reflections as rounds 1-2 — deliberately
// unchanged.
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
  console.error(`\n[SMOKE TEST ROUND 3 ABORTED — no generative POST was made] ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  // --- Guard: refuse a second run of THIS script outright ---
  if (existsSync(GUARD_FILE)) {
    const record: unknown = JSON.parse(readFileSync(GUARD_FILE, 'utf8'));
    console.error('\n[SMOKE TEST ROUND 3 BLOCKED] A completed run already exists:');
    console.error(JSON.stringify(record, null, 2));
    console.error(`\nDelete ${GUARD_FILE} manually if a genuine re-run is intended.`);
    process.exit(1);
  }

  console.log('=== Preconditions ===');

  if (env.MINDLOGIC_MAX_RETRIES !== 0) {
    fail(
      `MINDLOGIC_MAX_RETRIES must be 0 for this smoke test (got ${String(env.MINDLOGIC_MAX_RETRIES)}). Run: MINDLOGIC_MAX_RETRIES=0 pnpm exec tsx scripts/mindlogic-smoke-test-round3.ts`,
    );
  }
  console.log('MINDLOGIC_MAX_RETRIES=0: confirmed');

  const hasApiKey = env.MINDLOGIC_API_KEY.length > 0;
  console.log('MINDLOGIC_API_KEY present:', hasApiKey);
  if (!hasApiKey) fail('MINDLOGIC_API_KEY missing.');

  // Boolean match only — never print the configured model value itself.
  const envModelMatches = env.MINDLOGIC_MODEL === 'gpt-5.4-mini';
  const featureModelMatches =
    getFeatureModelConfig('reflection_comparison').model === 'gpt-5.4-mini';
  console.log('env MINDLOGIC_MODEL matches gpt-5.4-mini:', envModelMatches);
  console.log(
    'reflection_comparison FEATURE_MODEL_CONFIG matches gpt-5.4-mini:',
    featureModelMatches,
  );
  if (!featureModelMatches) {
    fail('reflection_comparison is not configured to use gpt-5.4-mini.');
  }

  // Capture the app's structured logs in memory instead of letting them
  // print raw — so the safe upstream-error observability fields can be
  // isolated and reported cleanly, without relying on eyeballing
  // interleaved Fastify request-lifecycle log lines.
  const capturedLogLines: string[] = [];
  const captureStream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      capturedLogLines.push(chunk.toString('utf8'));
      callback();
    },
  });

  const app = buildApp({ loggerStream: captureStream });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });

  try {
    // --- Precondition: /ready, via a real HTTP request to the running server ---
    const readyResponse = await fetch(`${address}/ready`);
    const readyBody: unknown = await readyResponse.json();
    console.log('/ready status:', readyResponse.status, readyBody);
    if (readyResponse.status !== 200) {
      fail('/ready did not return 200 — database not reachable.');
    }

    // --- Precondition: gpt-5.4-mini must appear in GET /models/ ---
    const models = await app.mindlogicClient.getModelsWithStatus();
    const modelAvailable = models.models.some((m) => m.id === 'gpt-5.4-mini');
    console.log('GET /models/ status:', models.status, '— gpt-5.4-mini available:', modelAvailable);
    if (models.status !== 200) fail('GET /models/ did not return 200.');
    if (!modelAvailable) fail('gpt-5.4-mini is not present in GET /models/.');

    // --- Precondition: Mindlogic credits before the call — exact values ---
    const before = await app.mindlogicClient.getCreditsWithStatus();
    console.log('Mindlogic /credits/ before:', {
      status: before.status,
      used: before.credits.monthly_allocated.used,
      remaining: before.credits.monthly_allocated.remaining,
    });
    if (before.status !== 200) fail('GET /credits/ did not return 200 before the call.');
    if (Math.abs(before.credits.monthly_allocated.used - EXPECTED_PROVIDER_USED) > FLOAT_EPSILON) {
      fail(
        `monthly_allocated.used must be ${EXPECTED_PROVIDER_USED} before the call (was ${before.credits.monthly_allocated.used}).`,
      );
    }
    if (
      Math.abs(before.credits.monthly_allocated.remaining - EXPECTED_PROVIDER_REMAINING) >
      FLOAT_EPSILON
    ) {
      fail(
        `monthly_allocated.remaining must be ${EXPECTED_PROVIDER_REMAINING} before the call (was ${before.credits.monthly_allocated.remaining}).`,
      );
    }

    // --- Precondition: DB ledger state — exact values, no pending records ---
    const billingMonth = getBillingMonth();
    const [periodBefore] = await db
      .select()
      .from(creditPeriods)
      .where(eq(creditPeriods.billingMonth, billingMonth));
    console.log('DB period before:', {
      committedCredits: periodBefore?.committedCredits ?? null,
      reservedCredits: periodBefore?.reservedCredits ?? null,
    });
    if (periodBefore?.committedCredits !== 1) {
      fail(
        `DB committedCredits must be 1 before the call (was ${String(periodBefore?.committedCredits)}).`,
      );
    }
    if (periodBefore?.reservedCredits !== 0) {
      fail(
        `DB reservedCredits must be 0 before the call (was ${String(periodBefore?.reservedCredits)}).`,
      );
    }

    const pendingRecords = await db
      .select({ requestId: creditUsageRecords.requestId })
      .from(creditUsageRecords)
      .where(eq(creditUsageRecords.status, 'reconciliation_pending'));
    console.log('pending records before:', pendingRecords.length);
    if (pendingRecords.length > 0) {
      fail(
        `${pendingRecords.length} reconciliation_pending record(s) exist — resolve before proceeding.`,
      );
    }

    console.log(
      '\nAll preconditions satisfied. Making exactly one real POST /api/v1/reflections/compare (gpt-5.4-mini)...\n',
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
        { completedAt: new Date().toISOString(), requestId, httpStatus: response.status },
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
          'has commonGround/differences/topics:',
          'commonGround' in parsed.data && 'differences' in parsed.data && 'topics' in parsed.data,
        );
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
      console.log('route error code:', errorBody?.code);
      console.log('route error message:', errorBody?.message);
    }

    // --- Safe upstream observability, parsed from the app's own captured
    // structured log line for this requestId (never printed raw) ---
    const relevantLogEntry = capturedLogLines
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .find(
        (entry): entry is Record<string, unknown> =>
          entry !== null && entry.requestId === requestId && typeof entry.msg === 'string',
      );

    if (relevantLogEntry) {
      console.log('\n=== Safe upstream observability (from app log, requestId-matched) ===');
      console.log('outcome:', relevantLogEntry.outcome);
      if ('upstreamCode' in relevantLogEntry) {
        console.log('upstreamCode:', relevantLogEntry.upstreamCode);
        console.log('upstreamStatus:', relevantLogEntry.upstreamStatus);
        console.log('providerErrorCode:', relevantLogEntry.providerErrorCode ?? null);
        console.log('providerRequestId:', relevantLogEntry.providerRequestId ?? null);
        console.log('contentType:', relevantLogEntry.contentType ?? null);
        console.log('responseTopLevelKeys:', relevantLogEntry.responseTopLevelKeys ?? null);
        console.log('detailKind:', relevantLogEntry.detailKind ?? null);
        console.log('validationErrorCount:', relevantLogEntry.validationErrorCount ?? null);
        console.log('validationErrors (type+loc only):', relevantLogEntry.validationErrors ?? null);
      }
    } else {
      console.log('\n(no matching structured log entry found for this requestId)');
    }

    // --- DB ledger verification ---
    const [usageRecord] = await db
      .select()
      .from(creditUsageRecords)
      .where(eq(creditUsageRecords.requestId, requestId));
    const [periodAfter] = await db
      .select()
      .from(creditPeriods)
      .where(eq(creditPeriods.billingMonth, billingMonth));

    console.log('\n=== DB ledger ===');
    console.log('usage record status:', usageRecord?.status ?? '(not found)');
    console.log('usage record creditsReserved:', usageRecord?.creditsReserved ?? null);
    console.log('usage record creditsUsed:', usageRecord?.creditsUsed ?? null);
    console.log('period committedCredits:', periodAfter?.committedCredits ?? null);
    console.log('period reservedCredits:', periodAfter?.reservedCredits ?? null);

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
  console.error('\n[SMOKE TEST ROUND 3 ERROR]', error instanceof Error ? error.message : error);
  process.exit(1);
});
