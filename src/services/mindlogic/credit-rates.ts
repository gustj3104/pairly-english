/**
 * Allowed Mindlogic models and their credit unit prices.
 * The client can never choose a model; the server model (env MINDLOGIC_MODEL)
 * must always be a key of this table.
 */
export const MODEL_CREDIT_RATES = {
  'claude-haiku-4-5-20251001': {
    inputCreditsPerThousandTokens: 1,
    outputCreditsPerThousandTokens: 5,
  },
} as const;

export type AllowedModel = keyof typeof MODEL_CREDIT_RATES;

export function isAllowedModel(model: string): model is AllowedModel {
  return Object.prototype.hasOwnProperty.call(MODEL_CREDIT_RATES, model);
}
