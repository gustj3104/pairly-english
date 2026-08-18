import { createHash } from 'node:crypto';

/**
 * Derives a stable identity signal from the session's display name — this
 * MVP has no real user accounts, so "the same person" is defined as
 * "normalizes to the same string". Never derived from client-supplied
 * request-body input; always from `request.session.name` (see
 * src/plugins/session-gate.ts).
 */
export function normalizeParticipantKey(name: string): string {
  return name.trim().normalize('NFKC').toLowerCase();
}

const LOG_HASH_LENGTH = 12;

/**
 * Irreversible, truncated digest used ONLY in log lines — never the raw
 * participantKey or displayName (see README "Logging discipline" and
 * src/routes/study-days.ts). Truncation is deliberate: this only needs to
 * let an operator correlate log lines for the same participant across
 * requests, not reconstruct the original name.
 */
export function hashForLogging(participantKey: string): string {
  return createHash('sha256').update(participantKey).digest('hex').slice(0, LOG_HASH_LENGTH);
}
