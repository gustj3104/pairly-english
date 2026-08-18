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
const body = {
  title: 'Science news',
  sourceName: 'Reuters',
  sourceUrl: 'https://www.reuters.com/world/story',
  publishedAt: '2026-08-17T10:00:00Z',
  summary: 'Summary',
  content: words.join(' '),
  vocabulary: words.map((word) => ({ word, definition: word, example: word })),
};
const now = () => new Date('2026-08-18T03:00:00Z');
function client(response: object, onCall = vi.fn()) {
  return {
    client: new MindlogicClient({
      apiKey: 'fake',
      baseUrl: 'https://gateway.test',
      fetchImpl: async () => {
        onCall();
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    }),
    onCall,
  };
}
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
