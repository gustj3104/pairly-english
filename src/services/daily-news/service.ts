import type { CreditService } from '../credits/credit-service.js';
import type { MindlogicClient } from '../mindlogic/client.js';
import { generateDailyNews } from './generator.js';
import type { DailyNewsGenerationOutcome } from './generator.js';
import type { DailyNewsRepository } from './repository.js';

export class DailyNewsGenerationError extends Error {
  constructor(readonly outcome: Exclude<DailyNewsGenerationOutcome, { status: 'ok' }>) {
    super(`Daily news generation failed: ${outcome.status}`);
  }
}

export class DailyNewsService {
  constructor(
    private readonly repository: DailyNewsRepository,
    private readonly creditService: CreditService,
    private readonly mindlogicClient: MindlogicClient,
  ) {}

  /** Read-only lookup: never enters generation or credit reservation paths. */
  async findExisting(studyDate: string) {
    return this.repository.find(studyDate);
  }

  async getOrGenerate(studyDate: string, now: () => Date = () => new Date()) {
    const cached = await this.repository.find(studyDate);
    if (cached) return { article: cached, cached: true };
    return this.repository.getOrCreate(studyDate, async () => {
      const outcome = await generateDailyNews(studyDate, {
        creditService: this.creditService,
        mindlogicClient: this.mindlogicClient,
        now,
      });
      if (outcome.status !== 'ok') throw new DailyNewsGenerationError(outcome);
      return { ...outcome.article, generatedAt: outcome.generatedAt };
    });
  }
}
