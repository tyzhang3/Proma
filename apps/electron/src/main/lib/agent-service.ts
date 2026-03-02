/**
 * Agent 服务层（IPC 薄层）
 *
 * 职责：
 * - 创建 AgentOrchestrator / EventBus / Adapter 实例
 * - 注册 EventBus IPC 转发中间件（webContents.send）
 * - 导出 IPC handler 调用的薄包装函数
 * - 文件操作（saveFilesToAgentSession / copyFolderToSession）
 *
 * 所有业务逻辑已委托给 AgentOrchestrator。
 */

import { join, dirname, resolve, basename, extname, relative, isAbsolute } from 'node:path'
import { writeFileSync, mkdirSync, existsSync, statSync, copyFileSync } from 'node:fs'
import { cp, readdir } from 'node:fs/promises'
import type { WebContents } from 'electron'
import { AGENT_IPC_CHANNELS } from '@proma/shared'
import type {
  AgentSendInput,
  AgentGenerateTitleInput,
  AgentSaveFilesInput,
  AgentSavedFile,
  AgentCopyFolderInput,
  AgentSnapshotSessionFilesInput,
  AgentStreamEvent,
  AgentStreamErrorPayload,
  AgentSessionMeta,
  ErrorCode,
} from '@proma/shared'
import { ClaudeAgentAdapter } from './adapters/claude-agent-adapter'
import { AgentEventBus } from './agent-event-bus'
import { AgentOrchestrator } from './agent-orchestrator'
import { getAgentSessionWorkspacePath } from './config-paths'
import { resolveAgentCwdByWorkspaceId } from './agent-cwd-resolver'

function resolveSessionDir(input: { workspaceId?: string; workspaceSlug: string; sessionId: string }): string {
  if (input.workspaceId) {
    return resolveAgentCwdByWorkspaceId(input.workspaceId, input.sessionId).cwd
  }
  return getAgentSessionWorkspacePath(input.workspaceSlug, input.sessionId)
}

// ===== 实例创建 =====

const eventBus = new AgentEventBus()
const adapter = new ClaudeAgentAdapter()
const orchestrator = new AgentOrchestrator(adapter, eventBus)

interface ClassifiedAgentError {
  errorCode: ErrorCode
  retriable: boolean
  error: string
}

function classifyAgentError(error: string): ClassifiedAgentError {
  const lower = error.toLowerCase()

  if (lower.includes('渠道不存在')) {
    return { errorCode: 'invalid_request', retriable: false, error }
  }

  if (lower.includes('解密 api key 失败')) {
    return { errorCode: 'invalid_credentials', retriable: false, error }
  }

  if (lower.includes('会话正在处理中') || lower.includes('上一条消息仍在处理中')) {
    return { errorCode: 'service_unavailable', retriable: true, error }
  }

  if (lower.includes('429') || lower.includes('rate limit')) {
    return { errorCode: 'rate_limited', retriable: true, error }
  }

  const statusMatch = error.match(/\b([1-5]\d{2})\b/)
  if (statusMatch) {
    const statusCode = Number(statusMatch[1])
    if (statusCode >= 500 && statusCode <= 599) {
      return { errorCode: 'service_error', retriable: true, error }
    }
    if (statusCode >= 400 && statusCode <= 499) {
      return { errorCode: 'provider_error', retriable: false, error }
    }
  }

  if (
    lower.includes('fetch failed')
    || lower.includes('network')
    || lower.includes('econnreset')
    || lower.includes('etimedout')
    || lower.includes('timeout')
    || lower.includes('socket')
    || lower.includes('enotfound')
    || lower.includes('eai_again')
  ) {
    return { errorCode: 'network_error', retriable: true, error }
  }

  return { errorCode: 'unknown_error', retriable: false, error }
}

function sendStreamError(webContents: WebContents, payload: AgentStreamErrorPayload): void {
  webContents.send(AGENT_IPC_CHANNELS.STREAM_ERROR, payload)
}

/**
 * 会话 → webContents 映射
 *
 * EventBus IPC 转发中间件通过此映射找到目标 webContents。
 * runAgent 开始时注册，结束时清理。
 */
const sessionWebContents = new Map<string, WebContents>()

// ===== EventBus IPC 转发中间件 =====

eventBus.use((sessionId, event, next) => {
  const wc = sessionWebContents.get(sessionId)
  if (wc && !wc.isDestroyed()) {
    wc.send(AGENT_IPC_CHANNELS.STREAM_EVENT, { sessionId, event } as AgentStreamEvent)
  }
  next()
})

// ===== IPC 薄包装函数 =====

/**
 * 运行 Agent 并流式推送事件到渲染进程
 *
 * 注册 webContents 到 EventBus 映射，委托给 Orchestrator。
 */
export async function runAgent(
  input: AgentSendInput,
  webContents: WebContents,
): Promise<void> {
  // 并发检查：保护 sessionWebContents 映射不被覆盖
  if (sessionWebContents.has(input.sessionId)) {
    const error = '会话正在处理中'
    console.warn(`[Agent 服务] 会话 ${input.sessionId} 已在处理中，拒绝重复请求`)
    if (!webContents.isDestroyed()) {
      const classified = classifyAgentError(error)
      sendStreamError(webContents, {
        sessionId: input.sessionId,
        requestId: input.requestId,
        error: classified.error,
        errorCode: classified.errorCode,
        retriable: classified.retriable,
      })
    }
    return
  }

  sessionWebContents.set(input.sessionId, webContents)
  let hasErrorEventSent = false
  try {
    await orchestrator.sendMessage(input, {
      onError: (error) => {
        if (!webContents.isDestroyed()) {
          const classified = classifyAgentError(error)
          hasErrorEventSent = true
          sendStreamError(webContents, {
            sessionId: input.sessionId,
            requestId: input.requestId,
            error: classified.error,
            errorCode: classified.errorCode,
            retriable: classified.retriable,
          })
        }
      },
      onComplete: (messages) => {
        if (!webContents.isDestroyed()) {
          webContents.send(AGENT_IPC_CHANNELS.STREAM_COMPLETE, {
            sessionId: input.sessionId,
            requestId: input.requestId,
            messages,
          })
        }
      },
      onTitleUpdated: (title) => {
        if (!webContents.isDestroyed()) {
          webContents.send(AGENT_IPC_CHANNELS.TITLE_UPDATED, {
            sessionId: input.sessionId,
            title,
          })
        }
      },
    })
  } catch (error) {
    if (!hasErrorEventSent && !webContents.isDestroyed()) {
      const message = error instanceof Error ? error.message : '未知错误'
      const classified = classifyAgentError(message)
      sendStreamError(webContents, {
        sessionId: input.sessionId,
        requestId: input.requestId,
        error: classified.error,
        errorCode: classified.errorCode,
        retriable: classified.retriable,
      })
    }
    console.error('[Agent 服务] runAgent 执行失败:', error)
  } finally {
    sessionWebContents.delete(input.sessionId)
  }
}

/**
 * 生成 Agent 会话标题
 */
export async function generateAgentTitle(input: AgentGenerateTitleInput): Promise<string | null> {
  return orchestrator.generateTitle(input)
}

/**
 * 中止指定会话的 Agent 执行
 */
export function stopAgent(sessionId: string): void {
  orchestrator.stop(sessionId)
}

import {
  listAgentSessions,
  createAgentSession,
  getAgentSessionMessages,
  getAgentSessionMeta,
  updateAgentSessionMeta,
} from './agent-session-manager'

/** 更新 Agent 会话标题 */
export async function updateAgentSessionTitle(id: string, title: string): Promise<AgentSessionMeta> {
  return updateAgentSessionMeta(id, { title })
}

/** 更新 Agent 会话使用的模型和渠道 */
export async function updateAgentSessionModel(id: string, channelId: string, modelId: string): Promise<AgentSessionMeta> {
  return updateAgentSessionMeta(id, { channelId, modelId })
}

/** 中止所有活跃的 Agent 会话（应用退出时调用） */
export function stopAllAgents(): void {
  orchestrator.stopAll()
}

// ===== 文件操作 =====

/**
 * 保存文件到 Agent session 工作目录
 *
 * 将 base64 编码的文件写入 session 的 cwd，供 Agent 通过 Read 工具读取。
 */
export function saveFilesToAgentSession(input: AgentSaveFilesInput): AgentSavedFile[] {
  const sessionDir = resolveSessionDir(input)
  const results: AgentSavedFile[] = []
  const usedPaths = new Set<string>()

  for (const file of input.files) {
    let targetPath = join(sessionDir, file.filename)

    // 防止同名文件覆盖
    if (usedPaths.has(targetPath) || existsSync(targetPath)) {
      const dotIdx = file.filename.lastIndexOf('.')
      const baseName = dotIdx > 0 ? file.filename.slice(0, dotIdx) : file.filename
      const ext = dotIdx > 0 ? file.filename.slice(dotIdx) : ''
      let counter = 1
      let candidate = join(sessionDir, `${baseName}-${counter}${ext}`)
      while (usedPaths.has(candidate) || existsSync(candidate)) {
        counter++
        candidate = join(sessionDir, `${baseName}-${counter}${ext}`)
      }
      targetPath = candidate
    }
    usedPaths.add(targetPath)

    mkdirSync(dirname(targetPath), { recursive: true })
    const buffer = Buffer.from(file.data, 'base64')
    writeFileSync(targetPath, buffer)

    const actualFilename = targetPath.slice(sessionDir.length + 1)
    results.push({
      filename: actualFilename,
      targetPath,
      mediaType: file.mediaType || 'application/octet-stream',
      size: Buffer.from(file.data, 'base64').length,
    })
    console.log(`[Agent 服务] 文件已保存: ${targetPath} (${buffer.length} bytes)`)
  }

  return results
}

/**
 * 复制文件夹到 Agent session 工作目录（异步版本）
 *
 * 使用异步 fs.cp 递归复制整个文件夹，返回所有复制的文件列表。
 */
export async function copyFolderToSession(input: AgentCopyFolderInput): Promise<AgentSavedFile[]> {
  const { sourcePath } = input
  const sessionDir = resolveSessionDir(input)

  const folderName = sourcePath.split('/').filter(Boolean).pop() || 'folder'
  const targetDir = join(sessionDir, folderName)

  await cp(sourcePath, targetDir, { recursive: true })
  console.log(`[Agent 服务] 文件夹已复制: ${sourcePath} → ${targetDir}`)

  const results: AgentSavedFile[] = []
  const collectFiles = async (dir: string, relativeTo: string): Promise<void> => {
    const items = await readdir(dir, { withFileTypes: true })
    for (const item of items) {
      const fullPath = join(dir, item.name)
      if (item.isDirectory()) {
        await collectFiles(fullPath, relativeTo)
      } else {
        const relPath = fullPath.slice(relativeTo.length + 1)
        results.push({
          filename: relPath,
          targetPath: fullPath,
          mediaType: 'application/octet-stream', // TODO: 探测
          size: statSync(fullPath).size
        })
      }
    }
  }
  await collectFiles(targetDir, sessionDir)

  console.log(`[Agent 服务] 文件夹复制完成，共 ${results.length} 个文件`)
  return results
}

function isPathInside(baseDir: string, candidatePath: string): boolean {
  const rel = relative(baseDir, candidatePath)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * 快照 session 目录内文件到队列目录
 *
 * 目标路径：
 * {sessionDir}/.proma-queue/{queueId}/refs/{displayName}
 */
export function snapshotSessionFiles(input: AgentSnapshotSessionFilesInput): AgentSavedFile[] {
  const sessionDir = resolveSessionDir(input)
  const normalizedSessionDir = resolve(sessionDir)
  const queueRefsDir = join(sessionDir, '.proma-queue', input.queueId, 'refs')
  const normalizedQueueRefsDir = resolve(queueRefsDir)
  const results: AgentSavedFile[] = []
  const usedPaths = new Set<string>()

  for (const file of input.files) {
    const sourcePath = resolve(file.path)
    if (!isPathInside(normalizedSessionDir, sourcePath)) {
      throw new Error(`引用文件超出会话目录范围: ${file.path}`)
    }

    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
      throw new Error(`引用文件不存在或不可读: ${file.path}`)
    }

    const normalizedDisplay = file.displayName
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean)
      .join('/')
    const fallbackName = basename(sourcePath)
    const displayName = normalizedDisplay || fallbackName

    let targetPath = join(queueRefsDir, displayName)
    let safeTargetPath = resolve(targetPath)
    if (!isPathInside(normalizedQueueRefsDir, safeTargetPath)) {
      targetPath = join(queueRefsDir, fallbackName)
      safeTargetPath = resolve(targetPath)
    }

    if (usedPaths.has(safeTargetPath) || existsSync(safeTargetPath)) {
      const extension = extname(safeTargetPath)
      const targetDir = dirname(safeTargetPath)
      const baseName = basename(safeTargetPath, extension)
      let counter = 1
      let candidate = resolve(targetDir, `${baseName}-${counter}${extension}`)
      while (usedPaths.has(candidate) || existsSync(candidate)) {
        counter++
        candidate = resolve(targetDir, `${baseName}-${counter}${extension}`)
      }
      safeTargetPath = candidate
    }

    usedPaths.add(safeTargetPath)

    mkdirSync(dirname(safeTargetPath), { recursive: true })
    copyFileSync(sourcePath, safeTargetPath)

    const actualFilename = safeTargetPath.slice(sessionDir.length + 1)
    results.push({
      filename: actualFilename,
      targetPath: safeTargetPath,
      mediaType: 'application/octet-stream', // TODO: 探测
      size: statSync(safeTargetPath).size
    })
  }

  return results
}
