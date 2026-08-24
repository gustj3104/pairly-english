import type { AllowedModel } from './credit-rates.js';
import type { CreditFeature } from '../credits/types.js';

export interface FeatureModelConfig {
  model: AllowedModel;
  /** Fixed server-side cap passed as max_tokens. Never client-controllable. */
  maxOutputTokens: number;
}

/**
 * Per-feature model + output-token ceiling. The client never chooses a
 * model or a token limit — both come from here, keyed by feature, so a
 * new AI feature can only ever spend within a limit this file defines.
 * Only currently-implemented features have an entry; requesting an
 * unconfigured feature is a server bug, not a runtime input to handle
 * gracefully.
 */
export const FEATURE_MODEL_CONFIG: Partial<Record<CreditFeature, FeatureModelConfig>> = {
  // No automatic fallback to any other model — a rejected request here
  // must surface as a failure, never silently retry against a different
  // model (see reflection-comparison-service.ts's retry policy, which is
  // scoped to the same model/request, not a model switch).
  reflection_comparison: {
    model: 'gpt-5.4-mini',
    maxOutputTokens: 1500,
  },
  daily_news: {
    model: 'sonar-pro',
    maxOutputTokens: 2400,
  },
  dictionary_translation: {
    model: 'gpt-5.4-mini',
    // Was 96 — too small in practice. max_tokens caps *generation*, not a reservation
    // estimate: GPT-family tokenizers represent Hangul syllables far less densely than
    // estimateTokensUpperBound's byte-length upper bound implies (often 1.5-3 tokens per
    // syllable, not close to 1), so a single near-max-length translation (up to 30 Hangul
    // characters) alone can approach or exceed 60-90 tokens before any JSON structure or the
    // up-to-5-item array is counted. At 96, the model silently hit max_tokens mid-string on
    // production traffic (finish_reason: 'length'), truncating the JSON on every call — never a
    // model/schema/credit failure, so it went completely unlogged before this file's dictionary
    // -translation logging was added (see translation.ts's 'invalid_json' outcome, which now
    // reports finishReason/completionTokens specifically to catch this again if it recurs).
    // 400 gives ample headroom for the worst case (5 items x 30 chars + JSON overhead) while
    // remaining a tiny fraction of the monthly credit cap (worst-case reservation ceiling here
    // is under 2 credits/call; actual commitCredits() settles to real usage, typically far less).
    maxOutputTokens: 400,
  },
  // Minimal bare-messages diagnostic call — see scripts/mindlogic-contract-check.ts.
  provider_contract_check: {
    model: 'claude-haiku-4-5-20251001',
    maxOutputTokens: 20,
  },
};

export function getFeatureModelConfig(feature: CreditFeature): FeatureModelConfig {
  const config = FEATURE_MODEL_CONFIG[feature];
  if (!config) {
    throw new Error(`No FEATURE_MODEL_CONFIG entry for feature '${feature}'`);
  }
  return config;
}
