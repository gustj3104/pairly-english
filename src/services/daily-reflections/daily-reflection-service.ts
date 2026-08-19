import type {
  DailyReflectionRepository,
  ReflectionRow,
  StudyDayArticle,
  SubmitReflectionInput,
  SubmitReflectionResult,
} from './types.js';

export interface StudyDayParticipantStatus {
  submitted: boolean;
  displayName: string | null;
}

export interface StudyDayStatus {
  studyDate: string;
  mine: StudyDayParticipantStatus;
  partner: StudyDayParticipantStatus;
  readyToCompare: boolean;
}

export interface StudyDayReflectionProgress {
  displayName: string | null;
  submitted: boolean;
  content: string | null;
}

export interface StudyDayProgress {
  studyDate: string;
  mine: StudyDayReflectionProgress;
  partner: StudyDayReflectionProgress;
  readyToCompare: boolean;
}

export type ComparisonInputsResult =
  | {
      ok: true;
      article: StudyDayArticle;
      mine: ReflectionRow;
      partner: ReflectionRow;
    }
  | { ok: false; reason: 'partner_not_ready' };

/**
 * Thin service wrapping DailyReflectionRepository, mirroring
 * src/services/credits/credit-service.ts's split from
 * DrizzleCreditRepository — so unit tests can inject an in-memory fake
 * repository while integration tests use the real Drizzle-backed one.
 */
export class DailyReflectionService {
  constructor(private readonly repository: DailyReflectionRepository) {}

  submitReflection(input: SubmitReflectionInput): Promise<SubmitReflectionResult> {
    return this.repository.submitReflection(input);
  }

  async getStatus(studyDate: string, callerParticipantKey: string): Promise<StudyDayStatus> {
    const rows = await this.repository.getReflectionsForDate(studyDate);
    const mineRow = rows.find((row) => row.participantKey === callerParticipantKey) ?? null;
    const partnerRow = rows.find((row) => row.participantKey !== callerParticipantKey) ?? null;
    const distinctParticipants = new Set(rows.map((row) => row.participantKey)).size;

    return {
      studyDate,
      mine: { submitted: mineRow !== null, displayName: mineRow?.displayName ?? null },
      // Partner's content/reflection is deliberately never exposed here —
      // only submitted/displayName. See src/routes/study-days.ts.
      partner: { submitted: partnerRow !== null, displayName: partnerRow?.displayName ?? null },
      readyToCompare: distinctParticipants >= 2,
    };
  }

  /**
   * Unlike getStatus, this includes each side's reflection `content` —
   * used only by the session-gated /study-days/:date/progress route, which
   * the two paired participants use to review each other's actual
   * submitted reflection (by product decision, visible regardless of
   * whether the caller has submitted their own yet).
   */
  async getProgress(studyDate: string, callerParticipantKey: string): Promise<StudyDayProgress> {
    const rows = await this.repository.getReflectionsForDate(studyDate);
    const mineRow = rows.find((row) => row.participantKey === callerParticipantKey) ?? null;
    const partnerRow = rows.find((row) => row.participantKey !== callerParticipantKey) ?? null;
    const distinctParticipants = new Set(rows.map((row) => row.participantKey)).size;

    return {
      studyDate,
      mine: {
        displayName: mineRow?.displayName ?? null,
        submitted: mineRow !== null,
        content: mineRow?.content ?? null,
      },
      partner: {
        displayName: partnerRow?.displayName ?? null,
        submitted: partnerRow !== null,
        content: partnerRow?.content ?? null,
      },
      readyToCompare: distinctParticipants >= 2,
    };
  }

  async getComparisonInputs(
    studyDate: string,
    callerParticipantKey: string,
  ): Promise<ComparisonInputsResult> {
    const rows = await this.repository.getReflectionsForDate(studyDate);
    if (rows.length < 2) {
      return { ok: false, reason: 'partner_not_ready' };
    }

    const mine = rows.find((row) => row.participantKey === callerParticipantKey);
    const partner = rows.find((row) => row.participantKey !== callerParticipantKey);
    if (!mine || !partner) {
      // Two rows exist but neither belongs to the caller — shouldn't
      // happen in practice (the caller would be a 3rd participant, which
      // submitReflection already rejects), but defend against it rather
      // than crash.
      return { ok: false, reason: 'partner_not_ready' };
    }

    const article = await this.repository.getStudyDayArticle(studyDate);
    if (!article) {
      // Unreachable in practice: the reflections.study_date FK guarantees
      // a study_days row exists whenever a reflections row does.
      throw new Error(`study_days row for ${studyDate} could not be found`);
    }

    return { ok: true, article, mine, partner };
  }
}
