import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '../src/config/env.js';
import { db, pool } from '../src/db/client.js';
import { creditPeriods, creditUsageRecords } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { CreditService } from '../src/services/credits/credit-service.js';
import { DrizzleCreditRepository } from '../src/services/credits/credit-repository.js';
import { getBillingMonth } from '../src/services/credits/billing-period.js';
import { calculateCredits } from '../src/services/credits/credit-calculator.js';
import { createMindlogicClient } from '../src/services/mindlogic/create-client.js';
import { getFeatureModelConfig } from '../src/services/mindlogic/feature-config.js';
import { estimateChatRequestInputTokens } from '../src/services/mindlogic/token-estimate.js';
import {
  MindlogicApiError,
  UNCERTAIN_BILLING_ERROR_CODES,
} from '../src/services/mindlogic/types.js';
import type { ChatMessage } from '../src/services/mindlogic/types.js';

/**
 * One-shot, approved real bare-messages contract check: no response_format,
 * a trivial "reply with OK" prompt, max_tokens capped at 20. Goes through
 * the real CreditService/DrizzleCreditRepository ledger (feature:
 * 'provider_contract_check') and the real MindlogicClient — never bypasses
 * credit accounting just because this is a diagnostic call. Makes AT MOST
 * ONE generative POST. A dedicated guard file (distinct from
 * .mindlogic-smoke-test-completed.json) blocks a second run.
 *
 * Run with: MINDLOGIC_MAX_RETRIES=0 pnpm exec tsx scripts/mindlogic-contract-check.ts
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const GUARD_FILE = resolve(__dirname, '../.mindlogic-contract-check-completed.json');
const FEATURE = 'provider_contract_check' as const;

function fail(message: string): never {
  console.error(`\n[CONTRACT CHECK ABORTED — no generative POST was made] ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (existsSync(GUARD_FILE)) {
    const record: unknown = JSON.parse(readFileSync(GUARD_FILE, 'utf8'));
    console.error('\n[CONTRACT CHECK BLOCKED] A completed run already exists:');
    console.error(JSON.stringify(record, null, 2));
    console.error(`\nDelete ${GUARD_FILE} manually if a genuine re-run is intended.`);
    process.exit(1);
  }

  console.log('=== Preconditions ===');
  if (env.MINDLOGIC_MAX_RETRIES !== 0) {
    fail(
      `MINDLOGIC_MAX_RETRIES must be 0 for this check (got ${String(env.MINDLOGIC_MAX_RETRIES)}). Run: MINDLOGIC_MAX_RETRIES=0 pnpm exec tsx scripts/mindlogic-contract-check.ts`,
    );
  }
  console.log('MINDLOGIC_MAX_RETRIES=0: confirmed');

  const hasApiKey = env.MINDLOGIC_API_KEY.length > 0;
  console.log('MINDLOGIC_API_KEY present:', hasApiKey);
  if (!hasApiKey) fail('MINDLOGIC_API_KEY missing.');

  const mindlogicClient = createMindlogicClient();
  const creditService = new CreditService(
    new DrizzleCreditRepository(db),
    env.MINDLOGIC_MONTHLY_CREDIT_LIMIT,
  );

  try {
    // --- Precondition: Mindlogic credits before the call ---
    const before = await mindlogicClient.getCreditsWithStatus();
    console.log('\nMindlogic /credits/ before:', {
      status: before.status,
      used: before.credits.monthly_allocated.used,
      remaining: before.credits.monthly_allocated.remaining,
    });
    if (before.status !== 200) fail('GET /credits/ did not return 200 before the call.');
    if (before.credits.monthly_allocated.used !== 0) {
      fail(
        `monthly_allocated.used must be 0 before the call (was ${before.credits.monthly_allocated.used}).`,
      );
    }
    if (before.credits.monthly_allocated.remaining !== 5000) {
      fail(
        `monthly_allocated.remaining must be 5000 before the call (was ${before.credits.monthly_allocated.remaining}).`,
      );
    }

    const { model, maxOutputTokens } = getFeatureModelConfig(FEATURE);
    const messages: ChatMessage[] = [
      { role: 'system', content: "Follow the user's instruction and answer briefly." },
      { role: 'user', content: 'Reply with only the English word OK.' },
    ];
    const estimatedInputTokens = estimateChatRequestInputTokens({ messages });
    const requestId = randomUUID();

    // --- Reservation through the real credit ledger — never bypassed ---
    const reservation = await creditService.reserveCredits({
      requestId,
      feature: FEATURE,
      model,
      inputTokens: estimatedInputTokens,
      outputTokens: maxOutputTokens,
      now: new Date(),
    });

    console.log('\n=== Credit reservation ===');
    console.log('requestId:', requestId);
    console.log('reservation ok:', reservation.ok);
    if (!reservation.ok) {
      console.log('reason:', reservation.reason);
      fail('Reservation rejected — no generative POST made.');
    }
    console.log('creditsReserved:', reservation.record.creditsReserved);

    console.log('\nAll preconditions satisfied. Making exactly one real bare-messages POST...\n');

    // --- The one approved diagnostic call — no retry, no response_format ---
    let success:
      | {
          status: number;
          completion: Awaited<
            ReturnType<typeof mindlogicClient.createChatCompletionWithStatus>
          >['completion'];
          providerRequestId: string | null;
        }
      | undefined;
    let apiError: MindlogicApiError | undefined;
    try {
      success = await mindlogicClient.createChatCompletionWithStatus({
        model,
        max_tokens: maxOutputTokens,
        messages,
        stream: false,
      });
    } catch (error) {
      if (error instanceof MindlogicApiError) {
        apiError = error;
      } else {
        throw error;
      }
    }

    // Guard is written immediately once the one-shot attempt has resolved
    // either way — before any further credit-ledger processing — so a
    // crash below still blocks a second real POST for this script.
    writeFileSync(
      GUARD_FILE,
      JSON.stringify(
        {
          completedAt: new Date().toISOString(),
          requestId,
          httpStatus: success?.status ?? apiError?.status ?? null,
          errorCode: apiError?.code ?? null,
        },
        null,
        2,
      ),
    );

    console.log('=== Result ===');
    if (success) {
      const { status, completion, providerRequestId } = success;
      console.log('HTTP status:', status);
      console.log('response top-level keys:', Object.keys(completion));
      const content = completion.choices?.[0]?.message?.content;
      console.log('choices[0].message.content is a string:', typeof content === 'string');
      console.log('finish_reason:', completion.choices?.[0]?.finish_reason ?? '(absent)');
      console.log('usage object keys:', completion.usage ? Object.keys(completion.usage) : null);
      console.log('usage:', completion.usage ?? '(absent)');
      console.log('provider request id (header):', providerRequestId);
      console.log('response id field:', completion.id ?? '(absent)');
      console.log(
        'content matches expected "OK" (exact match, not printed):',
        typeof content === 'string' && content.trim() === 'OK',
      );

      if (!completion.usage) {
        // No usage in the response — conservative fail-closed commit,
        // matching the production convention in reflection-comparison-service.ts.
        await creditService.commitCredits(requestId, reservation.record.creditsReserved);
        console.log(
          '\ncommitted (no usage in response, conservative full-reservation commit):',
          reservation.record.creditsReserved,
        );
      } else {
        const actualCredits = calculateCredits(
          model,
          completion.usage.prompt_tokens,
          completion.usage.completion_tokens,
        );
        const creditsToCommit =
          actualCredits > reservation.record.creditsReserved
            ? reservation.record.creditsReserved
            : actualCredits;
        await creditService.commitCredits(requestId, creditsToCommit);
        console.log(
          '\ncommitted credits:',
          creditsToCommit,
          '(raw calculated:',
          actualCredits,
          ')',
        );
      }
    } else if (apiError) {
      console.log('HTTP status:', apiError.status);
      console.log('error code:', apiError.code);
      console.log('observability:', apiError.observability);

      if (UNCERTAIN_BILLING_ERROR_CODES.includes(apiError.code)) {
        await creditService.markReconciliationPending(requestId, apiError.code);
        console.log('\noutcome: reconciliation_pending (reservation held, not released)');
      } else {
        await creditService.releaseCredits(requestId, apiError.code);
        console.log('\noutcome: upstream_failed (reservation released)');
      }
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
    const after = await mindlogicClient.getCreditsWithStatus();
    console.log('\n=== Mindlogic /credits/ after ===');
    console.log('status:', after.status);
    console.log('used:', after.credits.monthly_allocated.used);
    console.log('remaining:', after.credits.monthly_allocated.remaining);
    console.log(
      'used delta:',
      after.credits.monthly_allocated.used - before.credits.monthly_allocated.used,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('\n[CONTRACT CHECK ERROR]', error instanceof Error ? error.message : error);
  process.exit(1);
});
