export class CreditRecordNotFoundError extends Error {
  constructor(requestId: string) {
    super(`No credit usage record found for requestId ${requestId}`);
    this.name = 'CreditRecordNotFoundError';
  }
}

/**
 * Thrown when commitCredits/releaseCredits is called on a usage record
 * that is not currently 'reserved' — e.g. committing twice, or releasing
 * an already-completed record. Callers must not silently ignore this.
 */
export class InvalidCreditTransitionError extends Error {
  constructor(requestId: string, fromStatus: string, action: 'commit' | 'release') {
    super(
      `Cannot ${action} credit usage record ${requestId}: current status is '${fromStatus}', expected 'reserved'`,
    );
    this.name = 'InvalidCreditTransitionError';
  }
}
