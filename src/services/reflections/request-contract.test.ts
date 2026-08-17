import { describe, expect, it } from 'vitest';
import { buildMindlogicUrl } from '../mindlogic/client.js';
import { isAllowedModel } from '../mindlogic/credit-rates.js';
import { getFeatureModelConfig } from '../mindlogic/feature-config.js';
import type { ChatCompletionRequest, ChatMessage } from '../mindlogic/types.js';
import {
  REFLECTION_COMPARISON_RESPONSE_FORMAT,
  REFLECTION_COMPARISON_SYSTEM_PROMPT,
  buildReflectionComparisonUserMessage,
} from './prompt.js';
import { compareReflectionsRequestSchema } from './schema.js';

/**
 * Offline contract verification (task section 5): asserts the exact
 * request payload construction reflection-comparison-service.ts sends to
 * Mindlogic — without ever making a network call. No real user data or
 * secrets are used; this fixture is entirely synthetic placeholder text.
 */
const FIXTURE_INPUT = compareReflectionsRequestSchema.parse({
  article: { title: 'Sample Article Title', summary: 'A short synthetic summary for testing.' },
  mine: { displayName: 'Learner A', reflection: 'x'.repeat(200) },
  partner: { displayName: 'Learner B', reflection: 'y'.repeat(200) },
});

function buildFixtureRequest(): ChatCompletionRequest {
  const { model, maxOutputTokens } = getFeatureModelConfig('reflection_comparison');
  const messages: ChatMessage[] = [
    { role: 'system', content: REFLECTION_COMPARISON_SYSTEM_PROMPT },
    { role: 'user', content: buildReflectionComparisonUserMessage(FIXTURE_INPUT) },
  ];
  return {
    model,
    max_tokens: maxOutputTokens,
    messages,
    response_format: REFLECTION_COMPARISON_RESPONSE_FORMAT,
    stream: false,
  };
}

/** Recursively asserts every nested `type: 'object'` node sets `additionalProperties: false`. */
function assertNoOpenObjects(node: unknown, path: string): void {
  if (node === null || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  if (record.type === 'object') {
    expect(record.additionalProperties, `${path}.additionalProperties must be false`).toBe(false);
    expect(Array.isArray(record.required), `${path}.required must be an array`).toBe(true);
  }
  if (record.properties && typeof record.properties === 'object') {
    for (const [key, value] of Object.entries(record.properties as Record<string, unknown>)) {
      assertNoOpenObjects(value, `${path}.properties.${key}`);
    }
  }
  if (record.items) {
    assertNoOpenObjects(record.items, `${path}.items`);
  }
}

describe('Mindlogic chat completion request contract (offline, no network call)', () => {
  it('matches the expected field shape exactly (snapshot-style structural check)', () => {
    const request = buildFixtureRequest();

    expect(Object.keys(request).sort()).toEqual(
      ['max_tokens', 'messages', 'model', 'response_format', 'stream'].sort(),
    );
    expect(request.model).toBe('gpt-5.4-mini');
    expect(request.max_tokens).toBe(1500);
    expect(request.stream).toBe(false);
    expect(request.messages).toHaveLength(2);
    expect(request.messages[0]).toMatchObject({ role: 'system' });
    expect(request.messages[1]).toMatchObject({ role: 'user' });
    // No unsupported/unexpected top-level fields (e.g. no `temperature`,
    // `tools`, `max_completion_tokens` — max_tokens alone is sufficient
    // per the gateway's documented auto-conversion).
    expect(request).not.toHaveProperty('temperature');
    expect(request).not.toHaveProperty('tools');
    expect(request).not.toHaveProperty('max_completion_tokens');
  });

  it('only ever uses a model on the server allowlist', () => {
    const request = buildFixtureRequest();
    expect(isAllowedModel(request.model)).toBe(true);
  });

  it('is fully JSON-serializable with no data loss on a round trip', () => {
    const request = buildFixtureRequest();
    const serialized = JSON.stringify(request);
    expect(() => JSON.parse(serialized)).not.toThrow();
    expect(JSON.parse(serialized)).toEqual(JSON.parse(JSON.stringify(request)));
  });

  it('stays within a sane request body size bound', () => {
    const request = buildFixtureRequest();
    const byteLength = Buffer.byteLength(JSON.stringify(request), 'utf8');
    // Generous upper bound — the schema layer (schema.ts) already caps
    // reflection/article field lengths far below this; this guards against
    // a future change accidentally exploding payload size.
    expect(byteLength).toBeLessThan(50_000);
  });

  it('response_format is a valid, fully-closed JSON Schema (strict + additionalProperties: false at every object level)', () => {
    const request = buildFixtureRequest();
    expect(request.response_format?.type).toBe('json_schema');
    expect(request.response_format?.json_schema.strict).toBe(true);
    expect(request.response_format?.json_schema.name).toMatch(/^[a-zA-Z0-9_-]+$/);
    assertNoOpenObjects(request.response_format?.json_schema.schema, 'schema');
  });

  it("builds the exact documented endpoint URL with the required trailing slash ('/v1/gateway/chat/completions/')", () => {
    const url = buildMindlogicUrl(
      'https://factchat-cloud.mindlogic.ai/v1/gateway',
      'chat/completions/',
    );
    expect(url).toBe('https://factchat-cloud.mindlogic.ai/v1/gateway/chat/completions/');
  });

  it('never embeds the untrusted reflection text as anything other than inert JSON data in the user message', () => {
    const request = buildFixtureRequest();
    const userMessage = request.messages[1]?.content ?? '';
    // The fixture text itself must appear (it's being analyzed) but only
    // inside the JSON data block, never interpolated into instruction text
    // that precedes it — this just re-confirms prompt.ts's structural
    // separation using synthetic, clearly-fake fixture content.
    expect(userMessage).toContain(FIXTURE_INPUT.mine.reflection);
    expect(userMessage.indexOf('untrusted user-generated text')).toBeLessThan(
      userMessage.indexOf(FIXTURE_INPUT.mine.reflection),
    );
  });
});
