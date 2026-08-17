import { describe, expect, it } from 'vitest';
import { evaluateReconciliation } from './reconciliation.js';

const LIMIT = 5000;

describe('evaluateReconciliation', () => {
  it('reports in_sync and auto-releasable pending when provider usage exactly matches committed', () => {
    const verdict = evaluateReconciliation({
      providerUsedCredits: 100,
      dbCommittedCredits: 100,
      pendingReservations: [{ requestId: 'r1', reservedCredits: 10 }],
      configuredMonthlyLimit: LIMIT,
    });

    expect(verdict.status).toBe('in_sync');
    expect(verdict.discrepancy).toBe(0);
    expect(verdict.autoReleasableRequestIds).toEqual(['r1']);
    expect(verdict.requiresManualReview).toBe(false);
  });

  it('flags provider-reports-less-than-committed as needing review but still auto-releasable', () => {
    const verdict = evaluateReconciliation({
      providerUsedCredits: 80,
      dbCommittedCredits: 100,
      pendingReservations: [{ requestId: 'r1', reservedCredits: 10 }],
      configuredMonthlyLimit: LIMIT,
    });

    expect(verdict.status).toBe('provider_reports_less_than_committed');
    expect(verdict.discrepancy).toBe(-20);
    expect(verdict.requiresManualReview).toBe(true);
    // Not implicated in any charge, so still safe to release.
    expect(verdict.autoReleasableRequestIds).toEqual(['r1']);
  });

  it('never auto-releases when there is no pending reservation to begin with, even if in sync', () => {
    const verdict = evaluateReconciliation({
      providerUsedCredits: 100,
      dbCommittedCredits: 100,
      pendingReservations: [],
      configuredMonthlyLimit: LIMIT,
    });

    expect(verdict.status).toBe('in_sync');
    expect(verdict.autoReleasableRequestIds).toEqual([]);
  });

  it('flags an unexplained discrepancy when provider usage is higher but nothing is pending — does not ignore it optimistically', () => {
    const verdict = evaluateReconciliation({
      providerUsedCredits: 150,
      dbCommittedCredits: 100,
      pendingReservations: [],
      configuredMonthlyLimit: LIMIT,
    });

    expect(verdict.status).toBe('unexplained_discrepancy');
    expect(verdict.discrepancy).toBe(50);
    expect(verdict.requiresManualReview).toBe(true);
    expect(verdict.autoReleasableRequestIds).toEqual([]);
  });

  it('never bulk-releases when multiple pending reservations could each explain the gap', () => {
    const verdict = evaluateReconciliation({
      providerUsedCredits: 150,
      dbCommittedCredits: 100,
      pendingReservations: [
        { requestId: 'r1', reservedCredits: 30 },
        { requestId: 'r2', reservedCredits: 40 },
      ],
      configuredMonthlyLimit: LIMIT,
    });

    expect(verdict.status).toBe('ambiguous_pending_needs_manual_review');
    expect(verdict.discrepancy).toBe(50);
    expect(verdict.requiresManualReview).toBe(true);
    expect(verdict.autoReleasableRequestIds).toEqual([]);
  });

  it('surfaces a specific, single-candidate suggestion but still requires manual confirmation', () => {
    const verdict = evaluateReconciliation({
      providerUsedCredits: 150,
      dbCommittedCredits: 100,
      pendingReservations: [{ requestId: 'only-one', reservedCredits: 60 }],
      configuredMonthlyLimit: LIMIT,
    });

    expect(verdict.status).toBe('ambiguous_pending_needs_manual_review');
    expect(verdict.requiresManualReview).toBe(true);
    expect(verdict.autoReleasableRequestIds).toEqual([]);
    expect(verdict.explanation).toContain('only-one');
  });

  it('flags discrepancy_exceeds_pending_reservations when even every pending reservation cannot explain the gap', () => {
    const verdict = evaluateReconciliation({
      providerUsedCredits: 500,
      dbCommittedCredits: 100,
      pendingReservations: [{ requestId: 'r1', reservedCredits: 30 }],
      configuredMonthlyLimit: LIMIT,
    });

    expect(verdict.status).toBe('discrepancy_exceeds_pending_reservations');
    expect(verdict.requiresManualReview).toBe(true);
    expect(verdict.autoReleasableRequestIds).toEqual([]);
  });

  it('uses the more conservative (higher) of provider-used and db-committed as the baseline for remaining budget', () => {
    const providerHigher = evaluateReconciliation({
      providerUsedCredits: 4900,
      dbCommittedCredits: 4000,
      pendingReservations: [{ requestId: 'r1', reservedCredits: 50 }],
      configuredMonthlyLimit: LIMIT,
    });
    expect(providerHigher.conservativeUsedBaseline).toBe(4900);
    expect(providerHigher.conservativeRemainingCredits).toBe(LIMIT - 4900 - 50);

    const dbHigher = evaluateReconciliation({
      providerUsedCredits: 100,
      dbCommittedCredits: 4000,
      pendingReservations: [{ requestId: 'r1', reservedCredits: 50 }],
      configuredMonthlyLimit: LIMIT,
    });
    expect(dbHigher.conservativeUsedBaseline).toBe(4000);
    expect(dbHigher.conservativeRemainingCredits).toBe(LIMIT - 4000 - 50);
  });

  it('floors conservativeRemainingCredits at 0 rather than going negative', () => {
    const verdict = evaluateReconciliation({
      providerUsedCredits: 4990,
      dbCommittedCredits: 4990,
      pendingReservations: [{ requestId: 'r1', reservedCredits: 100 }],
      configuredMonthlyLimit: LIMIT,
    });
    expect(verdict.conservativeRemainingCredits).toBe(0);
  });
});
