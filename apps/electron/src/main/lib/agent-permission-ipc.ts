import { AGENT_IPC_CHANNELS } from '@proma/shared'
import type { PermissionResponse } from '@proma/shared'

interface PermissionServiceLike {
  respondToPermission: (requestId: string, behavior: 'allow' | 'deny', alwaysAllow: boolean) => string | null
}

interface StreamSenderLike {
  send: (channel: string, payload: unknown) => void
}

/**
 * 处理权限响应并向渲染进程回推 permission_resolved 事件。
 */
export function handlePermissionResponse(
  permissionService: PermissionServiceLike,
  sender: StreamSenderLike,
  response: PermissionResponse,
): void {
  const { requestId, behavior, alwaysAllow } = response
  const sessionId = permissionService.respondToPermission(requestId, behavior, alwaysAllow)
  if (!sessionId) return

  sender.send(AGENT_IPC_CHANNELS.STREAM_EVENT, {
    sessionId,
    event: { type: 'permission_resolved', requestId, behavior },
  })
}

