import { describe, expect, test } from 'bun:test'
import { AGENT_IPC_CHANNELS } from '@proma/shared'
import type { PermissionResponse } from '@proma/shared'
import { handlePermissionResponse } from './agent-permission-ipc'

function makeResponse(overrides: Partial<PermissionResponse> = {}): PermissionResponse {
  return {
    requestId: 'req-1',
    behavior: 'allow',
    alwaysAllow: false,
    ...overrides,
  }
}

describe('agent-permission-ipc', () => {
  test('命中待处理请求时发送 permission_resolved 事件', () => {
    const calls: Array<{ channel: string; payload: unknown }> = []
    const sender = {
      send: (channel: string, payload: unknown) => {
        calls.push({ channel, payload })
      },
    }
    const permissionService = {
      respondToPermission: () => 'session-1',
    }

    handlePermissionResponse(permissionService, sender, makeResponse())

    expect(calls.length).toBe(1)
    expect(calls[0]!.channel).toBe(AGENT_IPC_CHANNELS.STREAM_EVENT)
    expect(calls[0]!.payload).toEqual({
      sessionId: 'session-1',
      event: {
        type: 'permission_resolved',
        requestId: 'req-1',
        behavior: 'allow',
      },
    })
  })

  test('未命中待处理请求时不发送事件', () => {
    const calls: Array<{ channel: string; payload: unknown }> = []
    const sender = {
      send: (channel: string, payload: unknown) => {
        calls.push({ channel, payload })
      },
    }
    const permissionService = {
      respondToPermission: () => null,
    }

    handlePermissionResponse(permissionService, sender, makeResponse({ behavior: 'deny', alwaysAllow: true }))

    expect(calls.length).toBe(0)
  })
})

