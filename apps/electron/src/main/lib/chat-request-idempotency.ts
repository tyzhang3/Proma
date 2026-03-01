import type { ChatMessage } from '@proma/shared'

/**
 * 是否已存在同 requestId 的 user 消息
 */
export function hasUserMessageWithRequestId(messages: ChatMessage[], requestId: string): boolean {
  return messages.some((msg) => msg.role === 'user' && msg.requestId === requestId)
}

/**
 * 从历史中移除同 requestId 的 user 消息，避免重试时重复注入当前用户输入
 */
export function stripUserMessageByRequestId(messages: ChatMessage[], requestId: string): ChatMessage[] {
  return messages.filter((msg) => !(msg.role === 'user' && msg.requestId === requestId))
}
