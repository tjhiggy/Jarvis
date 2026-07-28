export type ConversationRole = 'user' | 'assistant';

export interface NewConversationMessage {
  readonly guildId: string;
  readonly conversationId: string;
  readonly userId: string;
  readonly role: ConversationRole;
  readonly content: string;
  readonly timestamp: Date;
  readonly openaiResponseId?: string;
}

export interface ConversationMessage extends NewConversationMessage {
  readonly id: number;
}

export interface ConversationStore {
  append(message: NewConversationMessage): Promise<void>;
  getRecent(
    guildId: string,
    conversationId: string,
    limit: number,
  ): Promise<ConversationMessage[]>;
  clear(guildId: string, conversationId: string): Promise<number>;
  cleanup(olderThan: Date): Promise<number>;
  healthCheck(): Promise<boolean>;
  close(): Promise<void>;
}
