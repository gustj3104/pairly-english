/**
 * Allowed Mindlogic models and their credit unit prices.
 * The client can never choose a model; each feature's model comes from
 * FEATURE_MODEL_CONFIG (src/services/mindlogic/feature-config.ts), which
 * must always reference a key of this table.
 *
 * NOTE: Mindlogic's official docs (docs.mindlogic.ai) publish a per-model
 * credit-rate table at docs.mindlogic.ai/docs/puts/factchat/product/model-credits
 * — gpt-5.6-luna's rate below is taken directly from it. Every other entry
 * predates that discovery and is still an operator-supplied value, not
 * independently verified against an official source — 확인 불가. Update
 * each as its official rate is confirmed.
 */
export const MODEL_CREDIT_RATES = {
  'claude-haiku-4-5-20251001': {
    inputCreditsPerThousandTokens: 1,
    outputCreditsPerThousandTokens: 5,
  },
  'gpt-5.4-mini': {
    inputCreditsPerThousandTokens: 0.8,
    outputCreditsPerThousandTokens: 4.5,
  },
  // Mindlogic publishes no verified sonar-pro credit conversion rate.
  // These deliberately conservative ledger units are a reservation guard,
  // not a claim about provider pricing. Reconcile against GET /credits/.
  'sonar-pro': {
    inputCreditsPerThousandTokens: 3,
    outputCreditsPerThousandTokens: 15,
  },
  // Official published rate — confirmed against Mindlogic's own docs
  // (docs.mindlogic.ai/docs/puts/factchat/product/model-credits), unlike
  // every other entry in this table. Model ID and gateway endpoint
  // (/v1/gateway/chat/completions/) confirmed against
  // docs.mindlogic.ai/docs/sookmyung/api-gateway/getting-started/models.
  'gpt-5.6-luna': {
    inputCreditsPerThousandTokens: 0.2,
    outputCreditsPerThousandTokens: 1.2,
  },
} as const;

export type AllowedModel = keyof typeof MODEL_CREDIT_RATES;

export function isAllowedModel(model: string): model is AllowedModel {
  return Object.prototype.hasOwnProperty.call(MODEL_CREDIT_RATES, model);
}
