import { existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AgentWorkspace } from '@proma/shared'
import { getAgentSessionWorkspacePath } from './config-paths'
import { getAgentWorkspace } from './agent-workspace-manager'

function ensureDir(dir: string): string {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const stat = statSync(dir)
  if (!stat.isDirectory()) {
    throw new Error(`路径不是目录: ${dir}`)
  }
  return dir
}

export function resolveWorkspaceCwd(workspace: AgentWorkspace, sessionId: string): string {
  if (!workspace.rootPath) {
    return getAgentSessionWorkspacePath(workspace.slug, sessionId)
  }

  const rootPath = resolve(workspace.rootPath)
  const mode = workspace.cwdMode || 'workspace-root'

  try {
    if (mode === 'session-subdir') {
      return ensureDir(join(rootPath, sessionId))
    }
    return ensureDir(rootPath)
  } catch (error) {
    console.warn(`[Agent CWD] 工作区 rootPath 不可用，回退默认目录: ${rootPath}`, error)
    return getAgentSessionWorkspacePath(workspace.slug, sessionId)
  }
}

export function resolveAgentCwdByWorkspaceId(workspaceId: string | undefined, sessionId: string): {
  cwd: string
  workspace?: AgentWorkspace
  workspaceSlug?: string
} {
  if (!workspaceId) {
    return { cwd: homedir() }
  }

  const workspace = getAgentWorkspace(workspaceId)
  if (!workspace) {
    return { cwd: homedir() }
  }

  return {
    cwd: resolveWorkspaceCwd(workspace, sessionId),
    workspace,
    workspaceSlug: workspace.slug,
  }
}
