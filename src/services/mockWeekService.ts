export interface DayRecord {
  date: string
  day: string
  dateNum: number
  topic: string
  done: boolean
  partnerDone: boolean
  locked: boolean
}

/** Keyed by ISO date so any day — not just "today" — can be looked up or overlaid uniformly. */
const WEEK_RECORDS: Record<string, DayRecord> = {
  '2025-08-11': { date: '2025-08-11', day: 'Mon', dateNum: 11, topic: 'Technology', done: true, partnerDone: true, locked: false },
  '2025-08-12': { date: '2025-08-12', day: 'Tue', dateNum: 12, topic: 'Society', done: true, partnerDone: true, locked: false },
  '2025-08-13': { date: '2025-08-13', day: 'Wed', dateNum: 13, topic: 'Business', done: true, partnerDone: false, locked: false },
  '2025-08-14': { date: '2025-08-14', day: 'Thu', dateNum: 14, topic: 'Culture', done: false, partnerDone: false, locked: false },
  '2025-08-15': { date: '2025-08-15', day: 'Fri', dateNum: 15, topic: 'Environment', done: false, partnerDone: false, locked: true },
  '2025-08-16': { date: '2025-08-16', day: 'Sat', dateNum: 16, topic: 'Lifestyle', done: false, partnerDone: false, locked: true },
  '2025-08-17': { date: '2025-08-17', day: 'Sun', dateNum: 17, topic: 'Sports', done: false, partnerDone: false, locked: true },
}

export const TODAY_DATE_KEY = '2025-08-14'

export function getWeekRecords(): DayRecord[] {
  return Object.values(WEEK_RECORDS).sort((a, b) => a.date.localeCompare(b.date))
}

/** Overlays a live completion flag onto whichever record matches `dateKey`, without a separate "today" code path. */
export function withLiveCompletion(records: DayRecord[], dateKey: string, completed: boolean): DayRecord[] {
  return records.map(r => (r.date === dateKey ? { ...r, done: completed } : r))
}
