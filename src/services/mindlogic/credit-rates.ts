/**
 * Allowed Mindlogic models and their credit unit prices.
 * The client can never choose a model; each feature's model comes from
 * FEATURE_MODEL_CONFIG (src/services/mindlogic/feature-config.ts), which
 * must always reference a key of this table.
 *
 * NOTE: Mindlogic's official docs (docs.mindlogic.ai) publish no
 * per-model credit-rate table — only a /credits/ balance-query endpoint.
 * Every rate below (including the pre-existing Haiku entry) is therefore
 * an operator-supplied value, not independently verifiable against an
 * official source — 확인 불가.
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
  // gpt-5.6-luna: no per-model credit-rate table is published by Mindlogic
  // (see the file-level note above), and — unlike gpt-5.4-mini's rate,
  // which was set after a real smoke test — no real chat completion call
  // against this specific model has been made from this codebase yet.
  // These numbers are an operator-supplied reservation guard only, copied
  // from the nearest already-accepted reference point in this table
  // (gpt-5.4-mini, the other "mini/economical" tier model) rather than
  // invented from scratch — 확인 불가. Treat as provisional: reconcile
  // against GET /credits/ after the first real calls and correct this
  // table (and re-run a one-shot smoke test per the README procedure)
  // once Mindlogic's actual published rate for this model is known.
  'gpt-5.6-luna': {
    inputCreditsPerThousandTokens: 0.8,
    outputCreditsPerThousandTokens: 4.5,
  },
} as const;

export type AllowedModel = keyof typeof MODEL_CREDIT_RATES;

export function isAllowedModel(model: string): model is AllowedModel {
  return Object.prototype.hasOwnProperty.call(MODEL_CREDIT_RATES, model);
}
