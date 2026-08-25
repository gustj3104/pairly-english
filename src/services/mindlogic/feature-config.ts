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
    // gpt-5.4-mini previously passed the structured-output smoke test but
    // now returns a provider-backed 404/not_found in production. Use the
    // currently supported low-cost tier already proven by the dictionary
    // structured-output path. Failed comparisons remain explicit-retry
    // only; this change never triggers a provider call by itself.
    model: 'gpt-5.6-luna',
    maxOutputTokens: 1500,
  },
  daily_news: {
    model: 'sonar-pro',
    maxOutputTokens: 2400,
  },
  // Feature key kept as 'dictionary_translation' (the existing credit_feature Postgres enum
  // value) even though this feature now does a full AI dictionary lookup, not just translation
  // — adding a new enum value would require a migration that can't be applied via Render Shell
  // in production (see README "Dictionary lookup"). The model was gpt-5.4-mini until a
  // production 404 (upstreamCode: 'not_found') showed Mindlogic no longer serves it for this
  // call shape; gpt-5.6-luna is Mindlogic's currently supported low-cost tier and is now pinned
  // here instead. Reflection comparison now uses the same supported tier
  // after its own production gpt-5.4-mini request returned not_found.
  dictionary_translation: {
    model: 'gpt-5.6-luna',
    // One call now returns pronunciation + up to 5 koreanTranslations (<=30 chars each) + up to
    // 3 meanings (each a short partOfSpeech + a <=300-char definition + a <=200-char example),
    // all schema-length-capped (see ai-lookup.ts's DICTIONARY_LOOKUP_RESPONSE_FORMAT) specifically
    // so this budget stays boundable. Worst case: 3 meanings x ~75 tokens (definition+example+
    // partOfSpeech) + 5 Korean glosses x ~45 tokens (Hangul syllables run 1.5-3 tokens each, not
    // ~1 — see the dictionary_translation history this replaced) + JSON overhead. 800 gives
    // roughly 2x headroom over that worst case, following the same lesson as the translation-only
    // predecessor of this config (too-tight max_tokens silently truncated JSON on every call,
    // production-invisible until finishReason/completionTokens logging was added — see
    // ai-lookup.ts's 'invalid_json' outcome) — a tiny fraction of the monthly credit cap either way.
    maxOutputTokens: 800,
  },
  dictionary_generation: {
    model: 'gpt-5.6-luna',
    maxOutputTokens: 800,
  },
  // Discussion-transcript feedback: one call returns an overall summary,
  // a topic-coverage score/comment, and per-participant strengths/
  // improvements/useful expressions for both participants — needs enough
  // headroom to cover two full participant sections plus shared tips.
  // Same supported low-cost tier as reflection_comparison and the
  // dictionary features above.
  grammar_feedback: {
    model: 'gpt-5.6-luna',
    maxOutputTokens: 2000,
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
