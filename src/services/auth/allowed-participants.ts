import { normalizeParticipantKey } from '../daily-reflections/participant-key.js';

/**
 * The only two participant identities this deployment serves. A fixed
 * production invariant, not an injectable option — every call site below
 * imports this directly rather than accepting an override, so a forgotten
 * DI wire-up can never silently widen who's allowed to authenticate.
 */
export const ALLOWED_PARTICIPANT_KEYS = ['hyunji', 'hyeonseo'] as const;

export function isAllowedParticipantKey(name: string): boolean {
  return (ALLOWED_PARTICIPANT_KEYS as readonly string[]).includes(normalizeParticipantKey(name));
}

/**
 * Resolves "the other" participant from an already-normalized key. Callers
 * must only pass a key already known to be in ALLOWED_PARTICIPANT_KEYS
 * (e.g. derived from a session that passed session-gate) — this never
 * accepts or trusts client-supplied identity.
 */
export function getPartnerParticipantKey(myParticipantKey: string): string {
  const partner = ALLOWED_PARTICIPANT_KEYS.find((key) => key !== myParticipantKey);
  if (!partner) {
    throw new Error(`no partner participant key configured for "${myParticipantKey}"`);
  }
  return partner;
}
