export interface WorkspaceResolution {
  effectiveWorkspaceId: string | undefined
  shouldBackfillSessionWorkspace: boolean
  hasWorkspaceMismatch: boolean
}

export function resolveWorkspaceForSession(
  sessionWorkspaceId: string | undefined,
  inputWorkspaceId: string | undefined,
): WorkspaceResolution {
  if (sessionWorkspaceId && inputWorkspaceId && sessionWorkspaceId !== inputWorkspaceId) {
    return {
      effectiveWorkspaceId: sessionWorkspaceId,
      shouldBackfillSessionWorkspace: false,
      hasWorkspaceMismatch: true,
    }
  }

  if (sessionWorkspaceId) {
    return {
      effectiveWorkspaceId: sessionWorkspaceId,
      shouldBackfillSessionWorkspace: false,
      hasWorkspaceMismatch: false,
    }
  }

  if (inputWorkspaceId) {
    return {
      effectiveWorkspaceId: inputWorkspaceId,
      shouldBackfillSessionWorkspace: true,
      hasWorkspaceMismatch: false,
    }
  }

  return {
    effectiveWorkspaceId: undefined,
    shouldBackfillSessionWorkspace: false,
    hasWorkspaceMismatch: false,
  }
}

