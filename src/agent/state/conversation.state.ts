import { AIMessageChunk, BaseMessage } from '@langchain/core/messages';
import { v4 } from 'uuid';

export class ConversationState {
  private static instance: ConversationState;
  private messages: BaseMessage[] = [];
  private messageIds: Set<string> = new Set();

  // Internal buffers for streaming deltas
  private currentResponseBuffer = "";
  private currentToolCallBuffer = "";

  private constructor() {}

  public static getInstance(): ConversationState {
    if (!ConversationState.instance) {
      ConversationState.instance = new ConversationState();
    }
    return ConversationState.instance;
  }

  /**
   * Assigns a UUID to a message if it doesn't have one
   */
  private assignMessageId(message: BaseMessage): void {
    if (message.id === null || message.id === undefined) {
      message.id = v4();
      if (message.lc_kwargs) {
        message.lc_kwargs.id = message.id;
      }
    }
  }

  /**
   * Adds a complete message to the conversation if it's not already present
   */
  public addMessage(message: BaseMessage): void {
    this.assignMessageId(message);
    if (!this.messageIds.has(message.id!)) {
      this.messages.push(message);
      this.messageIds.add(message.id!);
    }
  }

  /**
   * Adds multiple messages if they're not already present
   */
  public addMessages(newMessages: BaseMessage[]): void {
    for (const message of newMessages) {
      this.addMessage(message);
    }
  }

  /**
   * Appends a text delta from a streaming event
   */
  public addTextDelta(delta: string): void {
    this.currentResponseBuffer += delta;
  }

  /**
   * Appends a tool call delta from a streaming event
   */
  public addToolCallDelta(delta: string): void {
    this.currentToolCallBuffer += delta;
  }

  /**
   * Finalizes the internal buffers into complete messages
   */
  private finalizeBuffers(): void {
    if (this.currentResponseBuffer.length > 0) {
      const msg = new AIMessageChunk({ content: this.currentResponseBuffer.trim() });
      this.addMessage(msg);
      this.currentResponseBuffer = "";
    }
    if (this.currentToolCallBuffer.length > 0) {
      const msg = new AIMessageChunk({ content: `Tool Call: ${this.currentToolCallBuffer}`.trim() });
      this.addMessage(msg);
      this.currentToolCallBuffer = "";
    }
  }

  public clearBuffers(): void {
    this.currentResponseBuffer = "";
    this.currentToolCallBuffer = "";
  }

  /**
   * Returns the complete conversation history
   */
  public getMessages(): BaseMessage[] {
    this.finalizeBuffers();
    return this.messages;
  }

  /**
   * Clears the conversation state
   */
  public clearMessages(): void {
    this.messages = [];
    this.messageIds.clear();
  }
}
