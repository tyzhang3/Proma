import { describe, expect, test } from 'bun:test'
import type { PermissionRequest, WorkspacePermissionDefaults } from '@proma/shared'
import { AgentPermissionService } from './agent-permission-service'

function makeOptions(toolUseID: string) {
  return {
    signal: new AbortController().signal,
    toolUseID,
  }
}

function createServiceContext(defaults: WorkspacePermissionDefaults, mode: 'auto' | 'smart' | 'supervised' = 'smart') {
  const service = new AgentPermissionService()
  const requests: PermissionRequest[] = []
  const canUseTool = service.createCanUseTool(
    'session-1',
    mode,
    defaults,
    (request) => { requests.push(request) },
  )
  return { service, requests, canUseTool }
}

describe('agent-permission-service defaults', () => {
  test('smart + allowWrite=true 自动允许 Write/Edit/NotebookEdit', async () => {
    const { canUseTool, requests } = createServiceContext({ allowWrite: true, allowExecute: false })

    const writeResult = await canUseTool('Write', { file_path: 'a.txt', content: 'x' }, makeOptions('w1'))
    const editResult = await canUseTool('Edit', { file_path: 'a.txt', old_string: 'x', new_string: 'y' }, makeOptions('e1'))
    const notebookResult = await canUseTool('NotebookEdit', { notebook_path: 'a.ipynb' }, makeOptions('n1'))

    expect(writeResult.behavior).toBe('allow')
    expect(editResult.behavior).toBe('allow')
    expect(notebookResult.behavior).toBe('allow')
    expect(requests.length).toBe(0)
  })

  test('smart + allowExecute=true 自动允许 Bash/Task/mcp__*', async () => {
    const { canUseTool, requests } = createServiceContext({ allowWrite: false, allowExecute: true })

    const bashResult = await canUseTool('Bash', { command: 'npm install' }, makeOptions('b1'))
    const taskResult = await canUseTool('Task', { description: 'run task' }, makeOptions('t1'))
    const mcpResult = await canUseTool('mcp__filesystem__read_file', { path: '/tmp/a.txt' }, makeOptions('m1'))

    expect(bashResult.behavior).toBe('allow')
    expect(taskResult.behavior).toBe('allow')
    expect(mcpResult.behavior).toBe('allow')
    expect(requests.length).toBe(0)
  })

  test('smart 默认开关关闭时，写入/执行会进入权限请求', async () => {
    const { canUseTool, requests, service } = createServiceContext({ allowWrite: false, allowExecute: false })

    const writePromise = canUseTool('Write', { file_path: 'a.txt', content: 'x' }, makeOptions('w1'))
    const bashPromise = canUseTool('Bash', { command: 'npm install' }, makeOptions('b1'))

    expect(requests.length).toBe(2)
    const firstSessionId = service.respondToPermission(requests[0]!.requestId, 'allow', false)
    const secondSessionId = service.respondToPermission(requests[1]!.requestId, 'deny', false)

    expect(firstSessionId).toBe('session-1')
    expect(secondSessionId).toBe('session-1')
    await expect(writePromise).resolves.toMatchObject({ behavior: 'allow' })
    await expect(bashPromise).resolves.toMatchObject({ behavior: 'deny' })
  })

  test('supervised 模式忽略默认开关（仍需确认）', async () => {
    const { canUseTool, requests, service } = createServiceContext({ allowWrite: true, allowExecute: true }, 'supervised')

    const promise = canUseTool('Write', { file_path: 'a.txt', content: 'x' }, makeOptions('w1'))
    expect(requests.length).toBe(1)

    service.respondToPermission(requests[0]!.requestId, 'allow', false)
    await expect(promise).resolves.toMatchObject({ behavior: 'allow' })
  })

  test('auto 模式仍直接允许，忽略默认开关和权限队列', async () => {
    const { canUseTool, requests } = createServiceContext({ allowWrite: false, allowExecute: false }, 'auto')

    const result = await canUseTool('Write', { file_path: 'a.txt', content: 'x' }, makeOptions('w1'))
    expect(result.behavior).toBe('allow')
    expect(requests.length).toBe(0)
  })

  test('会话白名单与默认开关并存：alwaysAllow 后续命中白名单', async () => {
    const { canUseTool, requests, service } = createServiceContext({ allowWrite: false, allowExecute: false })

    const first = canUseTool('Write', { file_path: 'a.txt', content: 'x' }, makeOptions('w1'))
    expect(requests.length).toBe(1)
    service.respondToPermission(requests[0]!.requestId, 'allow', true)
    await expect(first).resolves.toMatchObject({ behavior: 'allow' })

    const second = await canUseTool('Write', { file_path: 'b.txt', content: 'y' }, makeOptions('w2'))
    expect(second.behavior).toBe('allow')
    expect(requests.length).toBe(1)
  })

  test('Bash 一次 alwaysAllow 后本会话 Bash 直接放行', async () => {
    const { canUseTool, requests, service } = createServiceContext({ allowWrite: false, allowExecute: false })
    const cmd1 = 'cd "/tmp/demo" && python3 "24point.py"'
    const cmd2 = 'cd "/tmp/demo" && python3 "other.py"'

    const first = canUseTool('Bash', { command: cmd1 }, makeOptions('b1'))
    service.respondToPermission(requests[0]!.requestId, 'allow', true)
    await first

    const second = await canUseTool('Bash', { command: cmd1 }, makeOptions('b2'))
    expect(second.behavior).toBe('allow')

    const third = await canUseTool('Bash', { command: cmd2 }, makeOptions('b3'))
    expect(third.behavior).toBe('allow')
    expect(requests.length).toBe(1)
  })
})
