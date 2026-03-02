import { describe, expect, test } from 'bun:test'
import { buildPermissionResponse, formatPermissionToolName } from './permission-banner-utils'

describe('permission-banner-utils', () => {
  test('formatPermissionToolName: MCP 工具名格式化为 server / tool', () => {
    expect(formatPermissionToolName('mcp__filesystem__read_file')).toBe('filesystem / read_file')
    expect(formatPermissionToolName('mcp__foo__bar__baz')).toBe('foo / bar__baz')
  })

  test('formatPermissionToolName: 非 MCP 工具名保持原样', () => {
    expect(formatPermissionToolName('Write')).toBe('Write')
    expect(formatPermissionToolName('Bash')).toBe('Bash')
  })

  test('buildPermissionResponse 构建响应 payload', () => {
    expect(buildPermissionResponse('req-1', 'allow')).toEqual({
      requestId: 'req-1',
      behavior: 'allow',
      alwaysAllow: false,
    })

    expect(buildPermissionResponse('req-2', 'deny', true)).toEqual({
      requestId: 'req-2',
      behavior: 'deny',
      alwaysAllow: true,
    })
  })
})

