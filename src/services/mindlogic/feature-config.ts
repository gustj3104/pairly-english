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
  reflection_comparison: {
    model: 'claude-haiku-4-5-20251001',
    maxOutputTokens: 1500,
  },
};

export function getFeatureModelConfig(feature: CreditFeature): FeatureModelConfig {
  const config = FEATURE_MODEL_CONFIG[feature];
  if (!config) {
    throw new Error(`No FEATURE_MODEL_CONFIG entry for feature '${feature}'`);
  }
  return config;
}
