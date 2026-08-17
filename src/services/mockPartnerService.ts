function delay<T>(value: T, ms = 500): Promise<T> {
  return new Promise(resolve => setTimeout(() => resolve(value), ms))
}

export function connectPartner(inviteCode: string): Promise<{ partnerName: string }> {
  return delay({ partnerName: 'Jisoo' }, 700)
}

export function waitForPartnerSubmission(): Promise<void> {
  return delay(undefined, 400)
}
