import { CreditService } from '../src/services/credits/credit-service.js';
import { DrizzleCreditRepository } from '../src/services/credits/credit-repository.js';
import { db, pool } from '../src/db/client.js';
import { env } from '../src/config/env.js';

/**
 * Minimal operator CLI for resolving a 'reconciliation_pending' credit
 * usage record after manually checking Mindlogic's own GET /credits/ —
 * see src/services/credits/reconciliation.ts for the decision logic this
 * is meant to be paired with. No automatic scheduler; every invocation
 * is a deliberate, human-triggered action.
 *
 * Usage:
 *   pnpm exec tsx scripts/credit-reconcile.ts release <requestId>
 *   pnpm exec tsx scripts/credit-reconcile.ts commit <requestId> <actualCredits>
 */

const [, , action, requestId, extra] = process.argv;

async function main(): Promise<void> {
  if (!requestId || (action !== 'release' && action !== 'commit')) {
    console.error(
      'Usage: credit-reconcile.ts <release|commit> <requestId> [actualCredits (commit only)]',
    );
    process.exitCode = 1;
    return;
  }

  const creditService = new CreditService(
    new DrizzleCreditRepository(db),
    env.MINDLOGIC_MONTHLY_CREDIT_LIMIT,
  );

  try {
    if (action === 'release') {
      await creditService.reconcileRelease(requestId);
      console.log(`reconcileRelease: requestId ${requestId} -> released`);
    } else {
      const actualCredits = Number(extra);
      if (!Number.isFinite(actualCredits) || actualCredits < 0) {
        console.error('commit requires a non-negative numeric actualCredits argument');
        process.exitCode = 1;
        return;
      }
      await creditService.reconcileCommit(requestId, actualCredits);
      console.log(
        `reconcileCommit: requestId ${requestId} -> completed (${actualCredits} credits)`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
