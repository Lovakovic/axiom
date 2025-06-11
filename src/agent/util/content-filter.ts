/**
 * Utility functions to filter out provider-specific content types that are not 
 * compatible with other providers. Specifically, this filters out Anthropic's 
 * "thinking" content type which is not recognized by OpenAI or VertexAI APIs.
 */

import { AIMessage, AIMessageChunk, BaseMessage, MessageContent } from "@langchain/core/messages";

/**
 * Checks if a content item is an Anthropic thinking content type
 */
export function isThinkingContent(content: any): boolean {
  return typeof content === 'object' && 
         content !== null && 
         content.type === 'thinking';
}

/**
 * Filters out thinking content from a message content array
 */
export function filterContent(content: MessageContent): MessageContent {
  if (typeof content === 'string') {
    return content;
  }
  
  if (Array.isArray(content)) {
    const filteredContent = content.filter(item => !isThinkingContent(item));
    return filteredContent;
  }
  
  return content;
}

/**
 * Filters thinking content from a single message
 */
export function filterMessageContent(message: BaseMessage): BaseMessage {
  if (message instanceof AIMessage || message instanceof AIMessageChunk) {
    const filteredContent = filterContent(message.content);
    
    // Create a new message with filtered content
    const MessageClass = message.constructor as any;
    return new MessageClass({
      ...message,
      content: filteredContent,
      // Preserve other properties
      id: message.id,
      name: message.name,
      additional_kwargs: message.additional_kwargs,
      response_metadata: message.response_metadata,
      tool_calls: message.tool_calls,
      invalid_tool_calls: message.invalid_tool_calls,
      usage_metadata: message.usage_metadata
    });
  }
  
  return message;
}

/**
 * Filters thinking content from an array of messages
 */
export function filterMessages(messages: BaseMessage[]): BaseMessage[] {
  return messages.map(message => filterMessageContent(message));
}

/**
 * Filters thinking content from messages when preparing them for non-Anthropic providers
 */
export function prepareMessagesForProvider(messages: BaseMessage[], providerKey: string): BaseMessage[] {
  // Only filter for non-Anthropic providers
  if (providerKey === 'claude') {
    return messages;
  }
  
  return filterMessages(messages);
}