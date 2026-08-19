import { describe, expect, it, vi } from 'vitest';
import { CreditService } from '../credits/credit-service.js';
import { InMemoryCreditRepository } from '../../../tests/helpers/in-memory-credit-repository.js';
import { MindlogicClient } from '../mindlogic/client.js';
import { generateDailyNews } from './generator.js';

const words = [
  'advance',
  'climate',
  'energy',
  'research',
  'global',
  'project',
  'future',
  'benefit',
];
// 2026-08-18 is a Tuesday → the fixed weekday topic is 'Business & Economy'.
const body = {
  title: 'Science news',
  sourceName: 'Reuters',
  sourceUrl: 'https://www.reuters.com/world/story',
  publishedAt: '2026-08-17T10:00:00Z',
  summary: 'Summary',
  content: words.join(' '),
  vocabulary: words.map((word) => ({ word, definition: word, example: word })),
  topic: 'Business & Economy',
};
const now = () => new Date('2026-08-18T03:00:00Z');
function client(response: object, onCall = vi.fn<(requestBody: unknown) => void>()) {
  return {
    client: new MindlogicClient({
      apiKey: 'fake',
      baseUrl: 'https://gateway.test',
      fetchImpl: async (_url, init) => {
        const requestBody = init?.body ? JSON.parse(init.body as string) : undefined;
        onCall(requestBody);
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    }),
    onCall,
  };
}
/** `extra` overrides top-level completion fields (e.g. `citations`), not the article body. */
function success(extra: object = {}) {
  return {
    id: 'x',
    model: 'sonar-pro',
    choices: [{ message: { role: 'assistant', content: JSON.stringify(body) } }],
    usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
    citations: [body.sourceUrl],
    ...extra,
  };
}

/** Like `success`, but overrides fields inside the article JSON body itself. */
function successWithBody(bodyOverrides: object) {
  const overriddenBody = { ...body, ...bodyOverrides };
  return {
    id: 'x',
    model: 'sonar-pro',
    choices: [{ message: { role: 'assistant', content: JSON.stringify(overriddenBody) } }],
    usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
    citations: [overriddenBody.sourceUrl],
  };
}

describe('generateDailyNews', () => {
  it('accepts a strict response only when sourceUrl appears in citations', async () => {
    const { client: mindlogicClient } = client(success());
    const result = await generateDailyNews('2026-08-18', {
      creditService: new CreditService(new InMemoryCreditRepository(), 5000),
      mindlogicClient,
      now,
    });
    expect(result.status).toBe('ok');
  });
  it('fails closed when citations are absent or do not match', async () => {
    const { client: mindlogicClient } = client(
      success({ citations: ['https://www.bbc.com/news/other'] }),
    );
    const result = await generateDailyNews('2026-08-18', {
      creditService: new CreditService(new InMemoryCreditRepository(), 5000),
      mindlogicClient,
      now,
    });
    expect(result.status).toBe('upstream_schema_error');
  });
  it('does not call the provider when the hard cap cannot reserve', async () => {
    const { client: mindlogicClient, onCall } = client(success());
    const result = await generateDailyNews('2026-08-18', {
      creditService: new CreditService(new InMemoryCreditRepository(), 1),
      mindlogicClient,
      now,
    });
    expect(result.status).toBe('limit_exceeded');
    expect(onCall).not.toHaveBeenCalled();
  });
});

describe('generateDailyNews — weekday topic enforcement', () => {
  it("fails closed when the model's declared topic does not match the required weekday topic", async () => {
    // 2026-08-18 is a Tuesday → required topic is 'Business & Economy', not 'Science'.
    const { client: mindlogicClient } = client(successWithBody({ topic: 'Science' }));
    const result = await generateDailyNews('2026-08-18', {
      creditService: new CreditService(new InMemoryCreditRepository(), 5000),
      mindlogicClient,
      now,
    });
    expect(result.status).toBe('upstream_schema_error');
  });

  it('never leaks the model-response `topic` field into the returned article', async () => {
    const { client: mindlogicClient } = client(success());
    const result = await generateDailyNews('2026-08-18', {
      creditService: new CreditService(new InMemoryCreditRepository(), 5000),
      mindlogicClient,
      now,
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.article).not.toHaveProperty('topic');
    }
  });

  it('passes studyDate through to the final sonar-pro user message exactly', async () => {
    const { client: mindlogicClient, onCall } = client(success());
    await generateDailyNews('2026-08-18', {
      creditService: new CreditService(new InMemoryCreditRepository(), 5000),
      mindlogicClient,
      now,
    });
    const requestBody = onCall.mock.calls[0]?.[0] as {
      messages: { role: string; content: string }[];
    };
    const userMessage = requestBody.messages.find((message) => message.role === 'user');
    expect(userMessage?.content).toContain('2026-08-18');
  });

  it('includes the required weekday topic exactly once as a mandatory condition in the final prompt, and drops the old free-choice category list', async () => {
    const { client: mindlogicClient, onCall } = client(success());
    await generateDailyNews('2026-08-18', {
      creditService: new CreditService(new InMemoryCreditRepository(), 5000),
      mindlogicClient,
      now,
    });
    const requestBody = onCall.mock.calls[0]?.[0] as {
      messages: { role: string; content: string }[];
    };
    const systemMessage = requestBody.messages.find((message) => message.role === 'system');
    const userMessage = requestBody.messages.find((message) => message.role === 'user');
    const fullPrompt = `${systemMessage?.content}\n${userMessage?.content}`;

    // The required topic string appears in the user message as the mandatory condition.
    const topicOccurrences = userMessage?.content.split('Business & Economy').length ?? 1;
    expect(topicOccurrences - 1).toBe(1);

    // The old unconstrained candidate list must be gone — the model must
    // not be offered any other category to pick from instead.
    expect(fullPrompt).not.toMatch(/international,\s*science,\s*technology,\s*culture/i);
    for (const otherTopic of [
      'Technology',
      'Science',
      'Environment',
      'Culture & Entertainment',
      'Lifestyle & Health',
      'World & Society',
    ]) {
      expect(userMessage?.content).not.toContain(otherTopic);
    }
  });
});
