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
// A search_results title that word-overlaps with `body`'s own title/summary/content (via the
// shared vocabulary words), so it satisfies titleCorrelatesWithArticle by construction.
const matchingSearchResultTitle = 'Global energy research project shows advance';

/** `extra` overrides top-level completion fields (e.g. `search_results`), not the article body. */
function success(extra: object = {}) {
  return {
    id: 'x',
    model: 'sonar-pro',
    choices: [{ message: { role: 'assistant', content: JSON.stringify(body) } }],
    usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
    search_results: [{ title: matchingSearchResultTitle, url: body.sourceUrl }],
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
    search_results: [{ title: matchingSearchResultTitle, url: overriddenBody.sourceUrl }],
  };
}

describe('generateDailyNews', () => {
  it('accepts a strict response only when sourceUrl matches a verified, title-correlated search_results entry', async () => {
    const { client: mindlogicClient } = client(success());
    const result = await generateDailyNews('2026-08-18', {
      creditService: new CreditService(new InMemoryCreditRepository(), 5000),
      mindlogicClient,
      now,
    });
    expect(result.status).toBe('ok');
  });
  it('fails closed with source_results_mismatch when search_results are present but no entry matches sourceUrl', async () => {
    const { client: mindlogicClient } = client(
      success({
        search_results: [{ title: 'Unrelated story', url: 'https://www.bbc.com/news/other' }],
      }),
    );
    const result = await generateDailyNews('2026-08-18', {
      creditService: new CreditService(new InMemoryCreditRepository(), 5000),
      mindlogicClient,
      now,
    });
    expect(result.status).toBe('upstream_schema_error');
    if (result.status === 'upstream_schema_error') {
      expect(result.reason).toBe('source_results_mismatch');
      expect(result.sourceDiagnostics).toEqual({
        sourceHostname: 'www.reuters.com',
        sourceAllowlisted: true,
        searchResultsPresent: true,
        searchResultCount: 1,
        searchResultHostnames: ['www.bbc.com'],
        searchResultAllowlistedCount: 1,
      });
    }
  });

  it('fails closed with source_results_missing when the completion carries no usable search_results array', async () => {
    const { client: mindlogicClient } = client(success({ search_results: undefined }));
    const result = await generateDailyNews('2026-08-18', {
      creditService: new CreditService(new InMemoryCreditRepository(), 5000),
      mindlogicClient,
      now,
    });
    expect(result.status).toBe('upstream_schema_error');
    if (result.status === 'upstream_schema_error') {
      expect(result.reason).toBe('source_results_missing');
      expect(result.sourceDiagnostics?.searchResultsPresent).toBe(false);
      expect(result.sourceDiagnostics?.sourceAllowlisted).toBe(true);
    }
  });

  it('fails closed with source_title_uncorrelated when the matched search_results entry is a real, allowlisted, same-domain result about a different story', async () => {
    // The exact production bug (2026-08-24): the model's own sourceUrl is a real Reuters URL
    // that genuinely appears in search_results — just not the one about the story it wrote.
    const { client: mindlogicClient } = client(
      success({
        search_results: [
          { title: matchingSearchResultTitle, url: 'https://www.reuters.com/world/other-story' },
          { title: 'A completely unrelated story about something else', url: body.sourceUrl },
        ],
      }),
    );
    const result = await generateDailyNews('2026-08-18', {
      creditService: new CreditService(new InMemoryCreditRepository(), 5000),
      mindlogicClient,
      now,
    });
    expect(result.status).toBe('upstream_schema_error');
    if (result.status === 'upstream_schema_error') {
      expect(result.reason).toBe('source_title_uncorrelated');
    }
  });

  it('fails closed with source_not_allowlisted when the model cites an off-allowlist host', async () => {
    const { client: mindlogicClient } = client(
      successWithBody({
        sourceUrl: 'https://www.cnn.com/world/story',
      }),
    );
    const result = await generateDailyNews('2026-08-18', {
      creditService: new CreditService(new InMemoryCreditRepository(), 5000),
      mindlogicClient,
      now,
    });
    expect(result.status).toBe('upstream_schema_error');
    if (result.status === 'upstream_schema_error') {
      expect(result.reason).toBe('source_not_allowlisted');
      expect(result.sourceDiagnostics).toEqual({
        sourceHostname: 'www.cnn.com',
        sourceAllowlisted: false,
        searchResultsPresent: true,
        searchResultCount: 1,
        searchResultHostnames: ['www.cnn.com'],
        searchResultAllowlistedCount: 0,
      });
    }
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

// Regression fixture for the exact production incident (2026-08-24): the served article was a
// Sonova AI-hearing-aid story but its Source link pointed at an unrelated Pony.ai/Uber robotaxi
// story — a real, allowlisted, same-domain (reuters.com) URL, just not the one behind the
// article's own content. Both search results below are real reuters.com URLs on purpose: the
// fix must reject based on story correlation, never merely "different hostname".
describe('generateDailyNews — Sonova/Pony.ai same-domain, wrong-story regression (2026-08-24)', () => {
  const sonovaSourceUrl = 'https://www.reuters.com/technology/sonova-ai-hearing-aids-2026-08-14/';
  const ponyaiSourceUrl =
    'https://www.reuters.com/technology/chinas-ponyai-uber-jointly-deploy-over-2000-robotaxis-europe-2026-08-14/';
  const sonovaSearchResult = {
    title: 'Sonova launches AI-powered hearing aids',
    url: sonovaSourceUrl,
  };
  const ponyaiSearchResult = {
    title: 'Pony.ai and Uber deploy robotaxis in Europe',
    url: ponyaiSourceUrl,
  };
  const sonovaWords = [
    'sonova',
    'unveiled',
    'advanced',
    'hearing',
    'devices',
    'research',
    'global',
    'demand',
  ];
  const sonovaBody = {
    title: 'AI-powered hearing aids show how everyday health devices are becoming smarter',
    sourceName: 'Reuters',
    sourceUrl: sonovaSourceUrl,
    publishedAt: '2026-08-14T10:00:00Z',
    summary:
      'Swiss hearing-aid maker Sonova has launched its third hearing-aid platform using real-time artificial intelligence, aiming to strengthen its market position by offering smarter, more responsive devices.',
    content:
      'Sonova unveiled advanced hearing devices research showing global demand for smarter health platform technology continues rising steadily worldwide.',
    vocabulary: sonovaWords.map((word) => ({ word, definition: word, example: word })),
    topic: 'Business & Economy',
  };

  function sonovaCompletion(bodyOverrides: object, searchResults: object[]) {
    const overridden = { ...sonovaBody, ...bodyOverrides };
    return {
      id: 'x',
      model: 'sonar-pro',
      choices: [{ message: { role: 'assistant', content: JSON.stringify(overridden) } }],
      usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      search_results: searchResults,
    };
  }

  it('accepts the Sonova article when sourceUrl is the verified, correlated Sonova search result', async () => {
    const { client: mindlogicClient } = client(
      sonovaCompletion({}, [sonovaSearchResult, ponyaiSearchResult]),
    );
    const result = await generateDailyNews('2026-08-18', {
      creditService: new CreditService(new InMemoryCreditRepository(), 5000),
      mindlogicClient,
      now,
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.article.sourceUrl).toBe(sonovaSourceUrl);
    }
  });

  it('rejects the Sonova article when sourceUrl is the real but unrelated Pony.ai/Uber robotaxi URL — same domain is not enough', async () => {
    const { client: mindlogicClient } = client(
      // Sonova content unchanged; only the declared sourceUrl is swapped to the wrong (but
      // real, allowlisted, reuters.com) search result — exactly the production failure mode.
      sonovaCompletion({ sourceUrl: ponyaiSourceUrl }, [sonovaSearchResult, ponyaiSearchResult]),
    );
    const result = await generateDailyNews('2026-08-18', {
      creditService: new CreditService(new InMemoryCreditRepository(), 5000),
      mindlogicClient,
      now,
    });
    expect(result.status).toBe('upstream_schema_error');
    if (result.status === 'upstream_schema_error') {
      expect(result.reason).toBe('source_title_uncorrelated');
      // Both are reuters.com — proves the rejection isn't merely a hostname mismatch.
      expect(result.sourceDiagnostics?.sourceHostname).toBe('www.reuters.com');
      expect(result.sourceDiagnostics?.sourceAllowlisted).toBe(true);
    }
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
