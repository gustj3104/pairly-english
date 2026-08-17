/**
 * No real Claude tokenizer is available server-side, so this never claims
 * to be an exact token count — only a SAFE UPPER BOUND used solely to
 * size a credit reservation before the real call.
 *
 * DO NOT reintroduce a "typical bytes-per-token" divisor here (an earlier
 * version of this file divided UTF-8 byte length by 3, reasoning that
 * English text averages ~4 bytes/token). That ratio is only true for
 * common English prose — it is NOT a safe upper bound for arbitrary
 * input. Byte-level BPE tokenizers (the family Claude's tokenizer almost
 * certainly belongs to) can, for unusual byte sequences, produce tokens
 * as short as a single byte; CJK text and emoji in particular can
 * tokenize far more densely than English. The one invariant that DOES
 * hold for any byte-level tokenizer is `tokenCount <= byteCount`, since
 * every token consumes at least one byte. That is exactly what this
 * function returns: raw UTF-8 byte length, no division.
 *
 * If real usage data is ever collected to refine this, do not lower the
 * safety margin without deliberately re-verifying the worst case (CJK/
 * emoji/mixed-script input) stays safely reserved — see
 * reflection-comparison-service.test.ts's multilingual-input tests.
 */
export function estimateTokensUpperBound(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/** Small fixed per-message allowance (role/delimiter framing tokens most chat APIs add beyond raw content). */
const MESSAGE_OVERHEAD_TOKENS_PER_MESSAGE = 4;

/** Fixed floor added to every estimate, regardless of input size. */
const MINIMUM_RESERVATION_BUFFER_TOKENS = 50;

export interface ChatRequestTokenEstimateInput {
  /** The exact message contents that will be sent — reuse the same array used for the real request, don't reconstruct it. */
  messages: { content: string }[];
  /** The exact response_format object that will be sent, if any — its JSON Schema counts toward input tokens too. */
  responseFormatSchema?: unknown;
}

/**
 * Upper-bound input token estimate for an entire chat completion request:
 * every message's content, the serialized response_format schema (easy
 * to forget — it's part of the prompt context too), a small per-message
 * overhead, and a fixed minimum buffer.
 */
export function estimateChatRequestInputTokens(input: ChatRequestTokenEstimateInput): number {
  const messageBytes = input.messages.reduce(
    (sum, message) => sum + estimateTokensUpperBound(message.content),
    0,
  );
  const schemaBytes = input.responseFormatSchema
    ? estimateTokensUpperBound(JSON.stringify(input.responseFormatSchema))
    : 0;
  const overhead = input.messages.length * MESSAGE_OVERHEAD_TOKENS_PER_MESSAGE;

  return messageBytes + schemaBytes + overhead + MINIMUM_RESERVATION_BUFFER_TOKENS;
}
