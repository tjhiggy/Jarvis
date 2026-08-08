export interface TriviaQuestion {
  readonly id: string;
  readonly prompt: string;
  readonly answers: readonly string[];
  readonly correctAnswerIndex: number;
}

export interface TriviaRound {
  readonly id: string;
  readonly guildId: string;
  readonly channelId: string;
  readonly ownerUserId: string;
  readonly questionId: string;
  readonly status: 'open' | 'expired';
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TriviaAnswer {
  readonly guildId: string;
  readonly roundId: string;
  readonly userId: string;
  readonly correct: boolean;
  readonly answeredAt: Date;
}

export interface TriviaResults {
  readonly guildId: string;
  readonly roundId: string;
  readonly participantCount: number;
  readonly correctCount: number;
}
export interface ClaimedTriviaRound extends TriviaRound {
  readonly leaseToken: string;
}

export class TriviaServiceError extends Error {
  constructor(
    readonly code:
      | 'bot'
      | 'opted-out'
      | 'not-found'
      | 'expired'
      | 'duplicate-answer'
      | 'invalid-answer'
      | 'already-open'
      | 'full',
  ) {
    super(code);
  }
}

export const curatedTriviaCatalog: readonly TriviaQuestion[] = Object.freeze([
  Object.freeze({
    id: 'space-red-planet',
    prompt: 'Which planet is known as the Red Planet?',
    answers: Object.freeze(['Mercury', 'Venus', 'Mars', 'Jupiter']),
    correctAnswerIndex: 2,
  }),
  Object.freeze({
    id: 'ocean-largest',
    prompt: 'Which ocean is the largest on Earth?',
    answers: Object.freeze(['Atlantic', 'Indian', 'Pacific', 'Arctic']),
    correctAnswerIndex: 2,
  }),
  Object.freeze({
    id: 'math-triangle',
    prompt: 'How many sides does a triangle have?',
    answers: Object.freeze(['Three', 'Four', 'Five', 'Six']),
    correctAnswerIndex: 0,
  }),
]);

export const validateTriviaQuestion = (
  question: TriviaQuestion,
): TriviaQuestion => {
  if (!/^[a-z0-9-]{1,64}$/.test(question.id))
    throw new RangeError('Question ID is invalid.');
  if (question.prompt.trim().length < 3 || question.prompt.length > 500)
    throw new RangeError('Question prompt is invalid.');
  if (question.answers.length < 2 || question.answers.length > 4)
    throw new RangeError('Question must contain exactly 2 to 4 answers.');
  if (
    !Number.isInteger(question.correctAnswerIndex) ||
    question.correctAnswerIndex < 0 ||
    question.correctAnswerIndex >= question.answers.length
  )
    throw new RangeError('Question answer index is invalid.');
  const answers = question.answers.map((answer) => answer.trim());
  if (
    answers.some((answer) => answer.length === 0 || answer.length > 100) ||
    new Set(answers.map((answer) => answer.toLocaleLowerCase())).size !==
      answers.length
  )
    throw new RangeError('Question answers must be distinct bounded text.');
  if (
    question.prompt
      .toLocaleLowerCase()
      .includes(answers[question.correctAnswerIndex]!.toLocaleLowerCase())
  )
    throw new RangeError('Question prompt must not reveal the correct answer.');
  return question;
};

for (const question of curatedTriviaCatalog) validateTriviaQuestion(question);

type Repository = {
  getOptOut(guildId: string, userId: string): Promise<unknown>;
  setOptOut?(input: {
    guildId: string;
    userId: string;
    optedOutAt: Date;
  }): Promise<unknown>;
  clearOptOut?(guildId: string, userId: string): Promise<void>;
  deleteTriviaParticipant?(guildId: string, userId: string): Promise<number>;
  optOutTriviaParticipant?(
    guildId: string,
    userId: string,
    optedOutAt: Date,
  ): Promise<void>;
  createTriviaRound(round: TriviaRound): Promise<TriviaRound>;
  getTriviaRound(
    guildId: string,
    roundId: string,
  ): Promise<TriviaRound | undefined>;
  findOpenTriviaRound?(
    guildId: string,
    channelId: string,
  ): Promise<TriviaRound | undefined>;
  recordTriviaAnswer(answer: TriviaAnswer): Promise<TriviaAnswer>;
  expireTriviaRounds?(now: Date): Promise<number>;
  claimTriviaResultCards?(
    now: Date,
    limit: number,
  ): Promise<readonly ClaimedTriviaRound[]>;
  completeTriviaResultCard?(
    guildId: string,
    roundId: string,
    leaseToken: string,
    completedAt: Date,
  ): Promise<boolean>;
  releaseTriviaResultCard?(
    guildId: string,
    roundId: string,
    leaseToken: string,
    now: Date,
  ): Promise<boolean>;
  getTriviaResults?(guildId: string, roundId: string): Promise<TriviaResults>;
};

export class TriviaService {
  private readonly answered = new Set<string>();
  private readonly catalog: ReadonlyMap<string, TriviaQuestion>;
  private nextQuestion = 0;

  constructor(
    private readonly dependencies: {
      readonly repository: Repository;
      readonly now?: () => Date;
      readonly createId: () => string;
      readonly durationMs?: number;
      readonly maxParticipants?: number;
      readonly catalog?: readonly TriviaQuestion[];
    },
  ) {
    const questions = dependencies.catalog ?? curatedTriviaCatalog;
    questions.forEach(validateTriviaQuestion);
    this.catalog = new Map(
      questions.map((question) => [question.id, question]),
    );
  }

  async start(input: {
    guildId: string;
    channelId: string;
    ownerUserId: string;
  }): Promise<TriviaRound & { readonly question: TriviaQuestion }> {
    const now = this.now();
    if (
      await this.dependencies.repository.getOptOut(
        input.guildId,
        input.ownerUserId,
      )
    )
      throw new TriviaServiceError('opted-out');
    await this.recover();
    if (
      await this.dependencies.repository.findOpenTriviaRound?.(
        input.guildId,
        input.channelId,
      )
    )
      throw new TriviaServiceError('already-open');
    const question = [...this.catalog.values()][
      this.nextQuestion++ % this.catalog.size
    ]!;
    const round: TriviaRound = {
      id: this.dependencies.createId(),
      guildId: input.guildId,
      channelId: input.channelId,
      ownerUserId: input.ownerUserId,
      questionId: question.id,
      status: 'open',
      expiresAt: new Date(
        now.getTime() + (this.dependencies.durationMs ?? 60_000),
      ),
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.dependencies.repository.createTriviaRound(round);
    } catch {
      throw new TriviaServiceError('already-open');
    }
    return { ...round, question };
  }

  async answer(input: {
    guildId: string;
    channelId: string;
    roundId: string;
    userId: string;
    answerIndex: number;
    isBot?: boolean;
  }): Promise<TriviaAnswer> {
    if (input.isBot) throw new TriviaServiceError('bot');
    if (
      await this.dependencies.repository.getOptOut(input.guildId, input.userId)
    )
      throw new TriviaServiceError('opted-out');
    const round = await this.dependencies.repository.getTriviaRound(
      input.guildId,
      input.roundId,
    );
    if (
      !round ||
      round.guildId !== input.guildId ||
      round.channelId !== input.channelId
    )
      throw new TriviaServiceError('not-found');
    if (
      round.status !== 'open' ||
      round.expiresAt.getTime() <= this.now().getTime()
    )
      throw new TriviaServiceError('expired');
    const question = this.catalog.get(round.questionId);
    if (
      !question ||
      !Number.isInteger(input.answerIndex) ||
      input.answerIndex < 0 ||
      input.answerIndex >= question.answers.length
    )
      throw new TriviaServiceError('invalid-answer');
    const key = `${input.guildId}:${input.roundId}:${input.userId}`;
    if (this.answered.has(key))
      throw new TriviaServiceError('duplicate-answer');
    const existing = await this.dependencies.repository.getTriviaResults?.(
      input.guildId,
      input.roundId,
    );
    if (
      (existing?.participantCount ?? 0) >=
      (this.dependencies.maxParticipants ?? 100)
    )
      throw new TriviaServiceError('full');
    const answer: TriviaAnswer = {
      guildId: input.guildId,
      roundId: input.roundId,
      userId: input.userId,
      correct: input.answerIndex === question.correctAnswerIndex,
      answeredAt: this.now(),
    };
    try {
      await this.dependencies.repository.recordTriviaAnswer(answer);
    } catch {
      throw new TriviaServiceError('duplicate-answer');
    }
    this.answered.add(key);
    return answer;
  }

  async results(
    guildId: string,
    roundId: string,
  ): Promise<TriviaResults & { readonly status: TriviaRound['status'] }> {
    const round = await this.dependencies.repository.getTriviaRound(
      guildId,
      roundId,
    );
    if (!round) throw new TriviaServiceError('not-found');
    const stored = (await this.dependencies.repository.getTriviaResults?.(
      guildId,
      roundId,
    )) ?? { guildId, roundId, participantCount: 0, correctCount: 0 };
    return {
      ...stored,
      status:
        round.status === 'open' && round.expiresAt <= this.now()
          ? 'expired'
          : round.status,
    };
  }

  async optOut(guildId: string, userId: string): Promise<void> {
    const optedOutAt = this.now();
    if (this.dependencies.repository.optOutTriviaParticipant) {
      await this.dependencies.repository.optOutTriviaParticipant(
        guildId,
        userId,
        optedOutAt,
      );
      return;
    }
    if (!this.dependencies.repository.setOptOut)
      throw new Error('Trivia opt-out storage is unavailable.');
    await this.dependencies.repository.setOptOut({
      guildId,
      userId,
      optedOutAt,
    });
    await this.dependencies.repository.deleteTriviaParticipant?.(
      guildId,
      userId,
    );
  }

  async optIn(guildId: string, userId: string): Promise<void> {
    if (!this.dependencies.repository.clearOptOut)
      throw new Error('Trivia opt-in storage is unavailable.');
    await this.dependencies.repository.clearOptOut(guildId, userId);
  }

  async recover(): Promise<number> {
    return (
      (await this.dependencies.repository.expireTriviaRounds?.(this.now())) ?? 0
    );
  }
  async claimResultCards(limit = 100): Promise<readonly ClaimedTriviaRound[]> {
    return (
      (await this.dependencies.repository.claimTriviaResultCards?.(
        this.now(),
        limit,
      )) ?? []
    );
  }
  async completeResultCard(round: ClaimedTriviaRound): Promise<boolean> {
    return (
      (await this.dependencies.repository.completeTriviaResultCard?.(
        round.guildId,
        round.id,
        round.leaseToken,
        this.now(),
      )) ?? false
    );
  }
  async releaseResultCard(round: ClaimedTriviaRound): Promise<boolean> {
    return (
      (await this.dependencies.repository.releaseTriviaResultCard?.(
        round.guildId,
        round.id,
        round.leaseToken,
        this.now(),
      )) ?? false
    );
  }
  question(round: TriviaRound): TriviaQuestion | undefined {
    return this.catalog.get(round.questionId);
  }
  private now(): Date {
    return new Date((this.dependencies.now ?? (() => new Date()))().getTime());
  }
}

export const buildTriviaResultsCard = (
  results: Pick<TriviaResults, 'participantCount' | 'correctCount'>,
): EngagementCard =>
  buildEngagementCard({
    title: 'MuthaShip trivia results',
    description: `Round closed. ${results.correctCount} of ${results.participantCount} participants answered correctly.`,
  });

export class TriviaExpiryScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private activeTick: Promise<void> | undefined;
  private lastRunValue:
    | { status: 'success' | 'error'; at: Date }
    | undefined;
  constructor(
    private readonly dependencies: {
      readonly service: Pick<
        TriviaService,
        | 'claimResultCards'
        | 'results'
        | 'completeResultCard'
        | 'releaseResultCard'
      >;
      readonly gateway: {
        post(round: ClaimedTriviaRound, results: TriviaResults): Promise<void>;
      };
      readonly intervalMs?: number;
      readonly isPaused?: (guildId: string) => Promise<boolean>;
      readonly logger?: {
        warn(fields: Record<string, string>, message: string): void;
      };
    },
  ) {}
  get healthy(): boolean {
    return this.timer !== undefined;
  }
  get lastRun():
    | Readonly<{ status: 'success' | 'error'; at: Date }>
    | undefined {
    return this.lastRunValue;
  }
  start(): void {
    if (!this.timer)
      this.timer = setInterval(
        () =>
          void this.tick().catch((error: unknown) =>
            this.dependencies.logger?.warn(
              {
                operation: 'trivia_expiry_tick',
                ...projectOperationalError(error, 'trivia_scheduler'),
              },
              'Trivia expiry tick failed.',
            ),
          ),
        this.dependencies.intervalMs ?? 15_000,
      );
  }
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.activeTick;
  }
  async tick(): Promise<void> {
    if (this.activeTick) return this.activeTick;
    this.activeTick = this.runTick()
      .then(() => {
        this.lastRunValue = { status: 'success', at: new Date() };
      })
      .catch((error: unknown) => {
        this.lastRunValue = { status: 'error', at: new Date() };
        throw error;
      })
      .finally(() => {
        this.activeTick = undefined;
      });
    return this.activeTick;
  }
  private async runTick(): Promise<void> {
    for (const round of await this.dependencies.service.claimResultCards()) {
      try {
        if (
          this.dependencies.isPaused !== undefined &&
          (await this.dependencies.isPaused(round.guildId))
        ) {
          await this.dependencies.service.releaseResultCard(round);
          continue;
        }
        const results = await this.dependencies.service.results(
          round.guildId,
          round.id,
        );
        await this.dependencies.gateway.post(round, results);
        await this.dependencies.service.completeResultCard(round);
      } catch {
        await this.dependencies.service.releaseResultCard(round);
      }
    }
  }
}
import { buildEngagementCard, type EngagementCard } from './discord-ui.js';
import { projectOperationalError } from '../utils/logger.js';
