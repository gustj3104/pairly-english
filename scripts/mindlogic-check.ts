import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { MindlogicClient } from '../src/services/mindlogic/client.js';
import { isAllowedModel, MODEL_CREDIT_RATES } from '../src/services/mindlogic/credit-rates.js';
import { MindlogicApiError } from '../src/services/mindlogic/types.js';

/**
 * Read-only Mindlogic connectivity check: GET /models/ and GET /credits/
 * only. Never performs a generative (POST) call, never prints the API key
 * or an Authorization header, and never dumps a full response body — only
 * the summarized fields below.
 *
 * Run with `pnpm mindlogic:check`. Not imported by src/app.ts or
 * src/server.ts — this is an operator tool, not part of the running
 * application, and is excluded from the production build (tsconfig.build.json
 * only includes src/**).
 */

export interface ModelsCheckSummary {
  status: number;
  modelCount: number;
  configuredModel: string;
  configuredModelAvailable: boolean;
  relevantModelIds: string[];
}

export interface CreditsCheckSummary {
  status: number;
  monthlyAllocated: { quota: number; used: number; remaining: number; renewalDate: string };
  purchased: { quota: number; used: number; remaining: number };
  total: { quota: number; used: number; remaining: number };
  configuredMonthlyLimit: number;
  quotaMatchesConfiguredLimit: boolean;
}

export interface MindlogicCheckResult {
  models: ModelsCheckSummary;
  credits: CreditsCheckSummary;
}

/**
 * Pure, testable core. Takes an already-constructed client so tests can
 * inject a mocked `fetchImpl` (see scripts/mindlogic-check.test.ts) — no
 * real network call happens here except through that client.
 */
export async function runMindlogicCheck(
  client: MindlogicClient,
  configuredModel: string,
  configuredMonthlyLimit: number,
): Promise<MindlogicCheckResult> {
  const { status: modelsStatus, models } = await client.getModelsWithStatus();
  const modelIds = models.map((model) => model.id);
  const allowListIds = Object.keys(MODEL_CREDIT_RATES);

  const modelsSummary: ModelsCheckSummary = {
    status: modelsStatus,
    modelCount: models.length,
    configuredModel,
    configuredModelAvailable: modelIds.includes(configuredModel),
    relevantModelIds: modelIds.filter((id) => allowListIds.includes(id)),
  };

  const { status: creditsStatus, credits } = await client.getCreditsWithStatus();
  const creditsSummary: CreditsCheckSummary = {
    status: creditsStatus,
    monthlyAllocated: {
      quota: credits.monthly_allocated.quota,
      used: credits.monthly_allocated.used,
      remaining: credits.monthly_allocated.remaining,
      renewalDate: credits.monthly_allocated.renewal_date,
    },
    purchased: { ...credits.purchased },
    total: { ...credits.total },
    configuredMonthlyLimit,
    quotaMatchesConfiguredLimit: credits.monthly_allocated.quota === configuredMonthlyLimit,
  };

  return { models: modelsSummary, credits: creditsSummary };
}

/** Strips anything resembling a bearer token, defense in depth beyond simply never logging it. */
function redactError(error: unknown): { message: string; code?: string; status?: number } {
  if (error instanceof MindlogicApiError) {
    return { message: 'Mindlogic request failed', code: error.code, status: error.status };
  }
  if (error instanceof Error) {
    return { message: error.message.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]') };
  }
  return { message: 'Unknown error' };
}

function printSummary(result: MindlogicCheckResult): void {
  console.log('=== GET /models/ ===');
  console.log('status:', result.models.status);
  console.log('model count:', result.models.modelCount);
  console.log(
    `configured model (${result.models.configuredModel}) available:`,
    result.models.configuredModelAvailable,
  );
  console.log(
    'allow-listed model ids seen:',
    result.models.relevantModelIds.join(', ') || '(none)',
  );

  console.log('\n=== GET /credits/ ===');
  console.log('status:', result.credits.status);
  console.log('monthly_allocated:', result.credits.monthlyAllocated);
  console.log('purchased:', result.credits.purchased);
  console.log('total:', result.credits.total);
  console.log('configured MINDLOGIC_MONTHLY_CREDIT_LIMIT:', result.credits.configuredMonthlyLimit);
  console.log('quota matches configured limit:', result.credits.quotaMatchesConfiguredLimit);

  if (!result.credits.quotaMatchesConfiguredLimit) {
    console.warn(
      '\nWARNING: Mindlogic-reported monthly_allocated.quota does not match ' +
        'MINDLOGIC_MONTHLY_CREDIT_LIMIT. Not auto-correcting — review and reconcile manually.',
    );
  }
}

const envSchema = z.object({
  MINDLOGIC_API_KEY: z.string().min(1, 'MINDLOGIC_API_KEY is required'),
  MINDLOGIC_BASE_URL: z.string().url('MINDLOGIC_BASE_URL must be a valid URL'),
  MINDLOGIC_MODEL: z.string().min(1, 'MINDLOGIC_MODEL is required'),
  MINDLOGIC_MONTHLY_CREDIT_LIMIT: z.coerce.number().int().positive(),
});

async function main(): Promise<void> {
  loadDotenv({ path: ['.env.local', '.env'], quiet: true });

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('mindlogic:check — missing or invalid environment variables:');
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exitCode = 1;
    return;
  }

  const { MINDLOGIC_API_KEY, MINDLOGIC_BASE_URL, MINDLOGIC_MODEL, MINDLOGIC_MONTHLY_CREDIT_LIMIT } =
    parsed.data;

  if (!isAllowedModel(MINDLOGIC_MODEL)) {
    console.error(
      `mindlogic:check — MINDLOGIC_MODEL '${MINDLOGIC_MODEL}' is not in the allowed model list.`,
    );
    process.exitCode = 1;
    return;
  }

  const client = new MindlogicClient({ apiKey: MINDLOGIC_API_KEY, baseUrl: MINDLOGIC_BASE_URL });

  try {
    const result = await runMindlogicCheck(client, MINDLOGIC_MODEL, MINDLOGIC_MONTHLY_CREDIT_LIMIT);
    printSummary(result);
    process.exitCode = 0;
  } catch (error) {
    console.error('mindlogic:check — request failed:', redactError(error));
    process.exitCode = 1;
  }
}

const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  void main();
}
