const draftTtlMs = 15 * 60 * 1_000;
const bioLimit = 500;
const interestsLimit = 300;
const unsafeMention = /@(?:everyone|here)\b|<@&\d+>/i;

export interface MemberProfile {
  readonly serverId: string;
  readonly userId: string;
  readonly bio: string | null;
  readonly interests: string | null;
  readonly visibility: 'visible' | 'hidden';
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface MemberProfileRepository {
  get(serverId: string, userId: string): Promise<MemberProfile | undefined>;
  create(profile: MemberProfile): Promise<'created' | 'duplicate'>;
  update(
    serverId: string,
    userId: string,
    values: Pick<MemberProfile, 'bio' | 'interests' | 'updatedAt'>,
  ): Promise<boolean>;
  setVisibility(
    serverId: string,
    userId: string,
    visibility: MemberProfile['visibility'],
    updatedAt: Date,
  ): Promise<boolean>;
  delete(serverId: string, userId: string): Promise<boolean>;
}

export interface IntroductionInterestReader {
  getSuggestedInterests(
    serverId: string,
    userId: string,
  ): Promise<string | null>;
}

export type MemberProfileOperation = 'create' | 'edit' | 'delete';
export interface MemberProfileDraft {
  readonly id: string;
  readonly serverId: string;
  readonly ownerUserId: string;
  readonly operation: MemberProfileOperation;
  readonly bio: string | null;
  readonly interests: string | null;
  readonly interestsSuggested: boolean;
  readonly expiresAt: Date;
}

export type MemberProfileErrorCode =
  | 'invalid-input'
  | 'draft-limit'
  | 'expired'
  | 'duplicate'
  | 'not-found'
  | 'duplicate-action';

export class MemberProfileServiceError extends Error {
  constructor(readonly code: MemberProfileErrorCode) {
    super(code);
  }
}

export class MemberProfileService {
  private readonly drafts = new Map<string, MemberProfileDraft>();
  private readonly confirming = new Set<string>();

  constructor(
    private readonly dependencies: Readonly<{
      repository: MemberProfileRepository;
      introductionReader?: IntroductionInterestReader;
      createId: () => string;
      now?: () => Date;
      maxDraftsPerOwner?: number;
    }>,
  ) {}

  async previewCreate(
    input: Readonly<{
      serverId: string;
      ownerUserId: string;
      bio: string;
      interests: string;
    }>,
  ): Promise<MemberProfileDraft> {
    const identity = this.identity(input.serverId, input.ownerUserId);
    if (
      await this.dependencies.repository.get(
        identity.serverId,
        identity.ownerUserId,
      )
    )
      throw new MemberProfileServiceError('duplicate');
    const bio = bounded(input.bio, bioLimit);
    let interests = bounded(input.interests, interestsLimit);
    let interestsSuggested = false;
    if (
      interests === null &&
      this.dependencies.introductionReader !== undefined
    ) {
      try {
        interests = bounded(
          (await this.dependencies.introductionReader.getSuggestedInterests(
            identity.serverId,
            identity.ownerUserId,
          )) ?? '',
          interestsLimit,
        );
        interestsSuggested = interests !== null;
      } catch {
        interests = null;
      }
    }
    return this.addDraft({
      ...identity,
      operation: 'create',
      bio,
      interests,
      interestsSuggested,
    });
  }

  async previewEdit(
    input: Readonly<{
      serverId: string;
      ownerUserId: string;
      bio: string;
      interests: string;
    }>,
  ): Promise<MemberProfileDraft> {
    const identity = this.identity(input.serverId, input.ownerUserId);
    if (
      !(await this.dependencies.repository.get(
        identity.serverId,
        identity.ownerUserId,
      ))
    )
      throw new MemberProfileServiceError('not-found');
    return this.addDraft({
      ...identity,
      operation: 'edit',
      bio: bounded(input.bio, bioLimit),
      interests: bounded(input.interests, interestsLimit),
      interestsSuggested: false,
    });
  }

  async previewDelete(
    serverId: string,
    ownerUserId: string,
  ): Promise<MemberProfileDraft> {
    const identity = this.identity(serverId, ownerUserId);
    if (
      !(await this.dependencies.repository.get(
        identity.serverId,
        identity.ownerUserId,
      ))
    )
      throw new MemberProfileServiceError('not-found');
    return this.addDraft({
      ...identity,
      operation: 'delete',
      bio: null,
      interests: null,
      interestsSuggested: false,
    });
  }

  async confirm(
    input: Readonly<{
      serverId: string;
      ownerUserId: string;
      draftId: string;
    }>,
  ): Promise<MemberProfile | null> {
    this.cleanupDrafts();
    const draft = this.drafts.get(input.draftId.trim());
    if (draft === undefined) throw new MemberProfileServiceError('expired');
    if (
      draft.serverId !== input.serverId.trim() ||
      draft.ownerUserId !== input.ownerUserId.trim()
    )
      throw new MemberProfileServiceError('invalid-input');
    if (this.confirming.has(draft.id))
      throw new MemberProfileServiceError('duplicate-action');
    this.confirming.add(draft.id);
    try {
      const now = this.now();
      if (draft.operation === 'delete') {
        if (
          !(await this.dependencies.repository.delete(
            draft.serverId,
            draft.ownerUserId,
          ))
        )
          throw new MemberProfileServiceError('not-found');
        this.drafts.delete(draft.id);
        return null;
      }
      if (draft.operation === 'create') {
        const profile: MemberProfile = {
          serverId: draft.serverId,
          userId: draft.ownerUserId,
          bio: draft.bio,
          interests: draft.interests,
          visibility: 'visible',
          createdAt: now,
          updatedAt: now,
        };
        if (
          (await this.dependencies.repository.create(profile)) === 'duplicate'
        )
          throw new MemberProfileServiceError('duplicate');
        this.drafts.delete(draft.id);
        return profile;
      }
      if (
        !(await this.dependencies.repository.update(
          draft.serverId,
          draft.ownerUserId,
          {
            bio: draft.bio,
            interests: draft.interests,
            updatedAt: now,
          },
        ))
      )
        throw new MemberProfileServiceError('not-found');
      this.drafts.delete(draft.id);
      return (
        (await this.dependencies.repository.get(
          draft.serverId,
          draft.ownerUserId,
        )) ?? null
      );
    } finally {
      this.confirming.delete(draft.id);
    }
  }

  cancel(
    input: Readonly<{ serverId: string; ownerUserId: string; draftId: string }>,
  ): boolean {
    this.cleanupDrafts();
    const draft = this.drafts.get(input.draftId.trim());
    if (
      draft === undefined ||
      draft.serverId !== input.serverId.trim() ||
      draft.ownerUserId !== input.ownerUserId.trim()
    )
      return false;
    this.drafts.delete(draft.id);
    return true;
  }

  get(serverId: string, userId: string): Promise<MemberProfile | undefined> {
    const identity = this.identity(serverId, userId);
    return this.dependencies.repository.get(
      identity.serverId,
      identity.ownerUserId,
    );
  }

  hide(serverId: string, userId: string): Promise<boolean> {
    const identity = this.identity(serverId, userId);
    return this.dependencies.repository.setVisibility(
      identity.serverId,
      identity.ownerUserId,
      'hidden',
      this.now(),
    );
  }

  show(serverId: string, userId: string): Promise<boolean> {
    const identity = this.identity(serverId, userId);
    return this.dependencies.repository.setVisibility(
      identity.serverId,
      identity.ownerUserId,
      'visible',
      this.now(),
    );
  }

  private addDraft(
    values: Omit<MemberProfileDraft, 'id' | 'expiresAt'>,
  ): MemberProfileDraft {
    this.cleanupDrafts();
    const count = [...this.drafts.values()].filter(
      (draft) =>
        draft.serverId === values.serverId &&
        draft.ownerUserId === values.ownerUserId,
    ).length;
    if (count >= (this.dependencies.maxDraftsPerOwner ?? 3))
      throw new MemberProfileServiceError('draft-limit');
    const now = this.now();
    const draft = {
      ...values,
      id: this.dependencies.createId(),
      expiresAt: new Date(now.getTime() + draftTtlMs),
    };
    this.drafts.set(draft.id, draft);
    return draft;
  }

  private identity(serverId: string, ownerUserId: string) {
    const normalized = {
      serverId: serverId.trim(),
      ownerUserId: ownerUserId.trim(),
    };
    if (normalized.serverId === '' || normalized.ownerUserId === '')
      throw new MemberProfileServiceError('invalid-input');
    return normalized;
  }

  private cleanupDrafts(): void {
    const now = this.now();
    for (const [id, draft] of this.drafts)
      if (draft.expiresAt <= now) this.drafts.delete(id);
  }

  private now(): Date {
    return (this.dependencies.now ?? (() => new Date()))();
  }
}

export const memberProfileRepositoryFromEngagement = (
  repository: Required<
    Pick<
      import('./storage.js').EngagementRepository,
      | 'getMemberProfile'
      | 'createMemberProfile'
      | 'updateMemberProfile'
      | 'setMemberProfileVisibility'
      | 'deleteMemberProfile'
    >
  >,
): MemberProfileRepository => ({
  get: repository.getMemberProfile.bind(repository),
  create: repository.createMemberProfile.bind(repository),
  update: repository.updateMemberProfile.bind(repository),
  setVisibility: repository.setMemberProfileVisibility.bind(repository),
  delete: repository.deleteMemberProfile.bind(repository),
});

const bounded = (value: string, maximum: number): string | null => {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > maximum || unsafeMention.test(trimmed))
    throw new MemberProfileServiceError('invalid-input');
  return trimmed.replace(/<@(?=[!]?\d+>)/g, '<@\u200b');
};
