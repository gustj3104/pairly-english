import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time-ish password comparison. Hashing both sides to a fixed
 * 32-byte digest first means `timingSafeEqual` (which itself throws if
 * given differently-sized buffers, an early exit that isn't
 * constant-time) never sees a length mismatch — the submitted
 * password's length can't leak through comparison timing either.
 */
export function timingSafeEqualPassword(submitted: string, expected: string): boolean {
  const submittedHash = createHash('sha256').update(submitted, 'utf8').digest();
  const expectedHash = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(submittedHash, expectedHash);
}
