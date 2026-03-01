import { describe, expect, test } from 'bun:test'
import type { ChatMessage } from '@proma/shared'
import { hasUserMessageWithRequestId, stripUserMessageByRequestId } from './chat-request-idempotency'

describe('chat-request-idempotency', () => {
  const baseMessages: ChatMessage[] = [
    { id: 'u1', role: 'user', content: 'first', createdAt: 1, requestId: 'r1' },
    { id: 'a1', role: 'assistant', content: 'ok', createdAt: 2 },
    { id: 'u2', role: 'user', content: 'retry target', createdAt: 3, requestId: 'retry-1' },
  ]

  test('hasUserMessageWithRequestId 能识别已落盘 requestId', () => {
    expect(hasUserMessageWithRequestId(baseMessages, 'retry-1')).toBe(true)
    expect(hasUserMessageWithRequestId(baseMessages, 'missing')).toBe(false)
  })

  test('stripUserMessageByRequestId 仅移除同 requestId 的 user 消息', () => {
    const next = stripUserMessageByRequestId(baseMessages, 'retry-1')
    expect(next.map((msg) => msg.id)).toEqual(['u1', 'a1'])
  })
})
