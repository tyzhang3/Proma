import { describe, expect, test } from 'bun:test'
import { resolveWorkspaceForSession } from './agent-workspace-resolution'

describe('resolveWorkspaceForSession', () => {
  test('会话已绑定 workspace 时优先使用会话值', () => {
    expect(resolveWorkspaceForSession('ws-session', 'ws-input')).toEqual({
      effectiveWorkspaceId: 'ws-session',
      shouldBackfillSessionWorkspace: false,
      hasWorkspaceMismatch: true,
    })
  })

  test('会话缺失 workspace 且请求携带 workspace 时，允许回填', () => {
    expect(resolveWorkspaceForSession(undefined, 'ws-input')).toEqual({
      effectiveWorkspaceId: 'ws-input',
      shouldBackfillSessionWorkspace: true,
      hasWorkspaceMismatch: false,
    })
  })

  test('会话与请求均缺失 workspace 时返回 undefined', () => {
    expect(resolveWorkspaceForSession(undefined, undefined)).toEqual({
      effectiveWorkspaceId: undefined,
      shouldBackfillSessionWorkspace: false,
      hasWorkspaceMismatch: false,
    })
  })
})
