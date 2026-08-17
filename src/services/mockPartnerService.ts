function delay<T>(value: T, ms = 500): Promise<T> {
  return new Promise(resolve => setTimeout(() => resolve(value), ms))
}

/**
 * Stand-in for a real user-sync backend, which doesn't exist yet (see
 * project README). Long enough to clear the server's 50-character
 * minimum reflection length with room to spare.
 */
const MOCK_PARTNER_REFLECTION =
  "I think the article makes a strong case that Korean cultural investment wasn't just marketing — the government subsidies gave film schools and production companies real infrastructure to build on. What stood out to me most was the idea of aesthetic laundering. It made me wonder whether Hollywood's interest in Korean stories is genuine curiosity or just a new aesthetic to borrow without the substance behind it. I'd like to talk more about whether audiences outside Korea can tell the difference."

export function connectPartner(inviteCode: string): Promise<{ partnerName: string }> {
  return delay({ partnerName: 'Jisoo' }, 700)
}

export function waitForPartnerSubmission(): Promise<void> {
  return delay(undefined, 400)
}

/**
 * Returns the partner's reflection text once they've "submitted". Kept
 * behind this service (rather than hardcoded in a page) so swapping in a
 * real sync backend later only touches this one function.
 */
export function getPartnerReflection(): Promise<string> {
  return delay(MOCK_PARTNER_REFLECTION, 300)
}
