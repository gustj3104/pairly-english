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
