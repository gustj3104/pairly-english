import { env } from '../../config/env.js';
import { MindlogicClient } from './client.js';

/**
 * Wires MindlogicClient to the app's env singleton. Deliberately kept out
 * of client.ts: that module must stay importable (e.g. by
 * scripts/mindlogic-check.ts) without pulling in src/config/env.ts, which
 * requires DATABASE_URL and other app-wide settings this class doesn't need.
 */
export function createMindlogicClient(): MindlogicClient {
  return new MindlogicClient({ apiKey: env.MINDLOGIC_API_KEY, baseUrl: env.MINDLOGIC_BASE_URL });
}
