import type { PermissionResponse } from '@proma/shared'

/** 解析工具显示名称（MCP 工具显示 server / tool） */
export function formatPermissionToolName(toolName: string): string {
  const parts = toolName.split('__')
  if (parts[0] === 'mcp' && parts.length >= 3) {
    return `${parts[1]} / ${parts.slice(2).join('__')}`
  }
  return toolName
}

/** 构建权限响应 payload */
export function buildPermissionResponse(
  requestId: string,
  behavior: 'allow' | 'deny',
  alwaysAllow = false,
): PermissionResponse {
  return {
    requestId,
    behavior,
    alwaysAllow,
  }
}

