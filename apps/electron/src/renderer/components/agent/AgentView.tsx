/**
 * AgentView — Agent 模式主视图容器
 *
 * 职责：
 * - 加载当前 Agent 会话消息
 * - 发送/停止/压缩 Agent 消息
 * - 附件上传处理
 * - AgentHeader 支持标题编辑 + 文件浏览器切换
 *
 * 注意：IPC 流式事件监听已提升到全局 useGlobalAgentListeners，
 * 本组件为纯展示 + 交互组件。
 *
 * 布局：AgentHeader | AgentMessages | AgentInput + 可选 FileBrowser 侧面板
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { Bot, CornerDownLeft, Square, Settings, Paperclip, FolderPlus, AlertCircle, X, FolderOpen, Copy, Check, Sparkles, FileText } from 'lucide-react'
import { AgentMessages } from './AgentMessages'
import { AgentHeader } from './AgentHeader'
import { ContextUsageBadge } from './ContextUsageBadge'
import { PermissionBanner } from './PermissionBanner'
import { PermissionModeSelector } from './PermissionModeSelector'
import { PermissionDefaultsSelector } from './PermissionDefaultsSelector'
import { AskUserBanner } from './AskUserBanner'
import { FileBrowser } from '@/components/file-browser'
import { ModelSelector } from '@/components/chat/ModelSelector'
import { AttachmentPreviewItem } from '@/components/chat/AttachmentPreviewItem'
import { RichTextInput } from '@/components/ai-elements/rich-text-input'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  currentAgentSessionIdAtom,
  currentAgentMessagesAtom,
  agentStreamingStatesAtom,
  agentStreamingAtom,
  agentChannelIdAtom,
  agentModelIdAtom,
  currentAgentWorkspaceIdAtom,
  agentPendingPromptAtom,
  agentPendingFilesAtom,
  agentWorkspacesAtom,
  agentContextStatusAtom,
  agentStreamErrorsAtom,
  currentAgentErrorAtom,
  currentAgentSessionDraftAtom,
  agentPromptSuggestionsAtom,
  currentAgentSuggestionAtom,
} from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import type {
  AgentMessage,
  AgentPendingFile,
  AgentSavedFile,
  AgentFileSuggestion,
  ModelOption,
  AgentSnapshotSessionFilesInput,
} from '@proma/shared'

/** 将 File 对象转为 base64 字符串 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]!
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function extractMentionQuery(content: string): string | null {
  const match = content.match(/(^|\s)@([^\s@]*)$/)
  if (!match) return null
  return match[2] ?? ''
}

function removeTrailingMention(content: string): string {
  const next = content.replace(/(^|\s)@([^\s@]*)$/, (_, prefix: string) => prefix)
  if (!next) return ''
  return /\s$/.test(next) ? next : `${next} `
}

export function AgentView(): React.ReactElement {
  const currentSessionId = useAtomValue(currentAgentSessionIdAtom)
  const [currentMessages, setCurrentMessages] = useAtom(currentAgentMessagesAtom)
  const setStreamingStates = useSetAtom(agentStreamingStatesAtom)
  const streaming = useAtomValue(agentStreamingAtom)
  const [agentChannelId, setAgentChannelId] = useAtom(agentChannelIdAtom)
  const [agentModelId, setAgentModelId] = useAtom(agentModelIdAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const [pendingPrompt, setPendingPrompt] = useAtom(agentPendingPromptAtom)
  const [pendingFiles, setPendingFiles] = useAtom(agentPendingFilesAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const contextStatus = useAtomValue(agentContextStatusAtom)
  const setAgentStreamErrors = useSetAtom(agentStreamErrorsAtom)
  const agentError = useAtomValue(currentAgentErrorAtom)
  const suggestion = useAtomValue(currentAgentSuggestionAtom)
  const setPromptSuggestions = useSetAtom(agentPromptSuggestionsAtom)

  const [inputContent, setInputContent] = useAtom(currentAgentSessionDraftAtom)
  const [fileBrowserOpen, setFileBrowserOpen] = React.useState(false)
  const [sessionPath, setSessionPath] = React.useState<string | null>(null)
  const [isDragOver, setIsDragOver] = React.useState(false)
  const [pendingFolderRefs, setPendingFolderRefs] = React.useState<AgentSavedFile[]>([])
  const [isUploadingFolder, setIsUploadingFolder] = React.useState(false)
  const [dragFolderWarning, setDragFolderWarning] = React.useState(false)
  const [errorCopied, setErrorCopied] = React.useState(false)
  const [mentionQuery, setMentionQuery] = React.useState('')
  const [mentionOpen, setMentionOpen] = React.useState(false)
  const [mentionLoading, setMentionLoading] = React.useState(false)
  const [mentionActiveIndex, setMentionActiveIndex] = React.useState(-1)
  const [mentionSuggestions, setMentionSuggestions] = React.useState<AgentFileSuggestion[]>([])
  const [mentionedFiles, setMentionedFiles] = React.useState<AgentFileSuggestion[]>([])
  const mentionRequestIdRef = React.useRef(0)

  // pendingFiles ref（供 addFilesAsAttachments 读取最新列表，避免闭包旧值）
  const pendingFilesRef = React.useRef(pendingFiles)
  React.useEffect(() => {
    pendingFilesRef.current = pendingFiles
  }, [pendingFiles])

  // 渠道已选但模型未选时，自动选择第一个可用模型
  React.useEffect(() => {
    if (!agentChannelId || agentModelId) return

    window.electronAPI.listChannels().then((channels) => {
      const channel = channels.find((c) => c.id === agentChannelId && c.enabled)
      if (!channel) return

      const firstModel = channel.models.find((m) => m.enabled)
      if (!firstModel) return

      setAgentModelId(firstModel.id)
      window.electronAPI.updateSettings({
        agentChannelId,
        agentModelId: firstModel.id,
      }).catch(console.error)
    }).catch(console.error)
  }, [agentChannelId, agentModelId, setAgentModelId])

  // 获取当前 session 的工作路径（文件浏览器需要）
  React.useEffect(() => {
    if (!currentSessionId || !currentWorkspaceId) {
      setSessionPath(null)
      return
    }

    window.electronAPI
      .getAgentSessionPath(currentWorkspaceId, currentSessionId)
      .then(setSessionPath)
      .catch(() => setSessionPath(null))
  }, [currentSessionId, currentWorkspaceId])

  // 加载当前会话消息
  React.useEffect(() => {
    if (!currentSessionId) {
      setCurrentMessages([])
      return
    }

    window.electronAPI
      .getAgentSessionMessages(currentSessionId)
      .then(setCurrentMessages)
      .catch(console.error)

  }, [currentSessionId, setCurrentMessages])

  React.useEffect(() => {
    setMentionedFiles([])
    setMentionOpen(false)
    setMentionQuery('')
    setMentionSuggestions([])
    setMentionActiveIndex(-1)
    setMentionLoading(false)
  }, [currentSessionId])

  // ===== 附件处理 =====

  /** 为文件生成唯一文件名（避免粘贴多张图片时文件名重复导致覆盖） */
  const makeUniqueFilename = React.useCallback((originalName: string, existingNames: string[]): string => {
    if (!existingNames.includes(originalName)) return originalName
    const dotIdx = originalName.lastIndexOf('.')
    const baseName = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName
    const ext = dotIdx > 0 ? originalName.slice(dotIdx) : ''
    let counter = 1
    while (existingNames.includes(`${baseName}-${counter}${ext}`)) {
      counter++
    }
    return `${baseName}-${counter}${ext}`
  }, [])

  /** 将 File 对象列表添加为待发送附件 */
  const addFilesAsAttachments = React.useCallback(async (files: File[]): Promise<void> => {
    // 收集已有的 pending 文件名，用于去重
    const usedNames: string[] = pendingFilesRef.current.map((f) => f.filename)

    for (const file of files) {
      try {
        const base64 = await fileToBase64(file)
        const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
        const uniqueFilename = makeUniqueFilename(file.name, usedNames)
        usedNames.push(uniqueFilename)

        const pending: AgentPendingFile = {
          id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          filename: uniqueFilename,
          mediaType: file.type || 'application/octet-stream',
          size: file.size,
          previewUrl,
        }

        if (!window.__pendingAgentFileData) {
          window.__pendingAgentFileData = new Map<string, string>()
        }
        window.__pendingAgentFileData.set(pending.id, base64)

        setPendingFiles((prev) => [...prev, pending])
      } catch (error) {
        console.error('[AgentView] 添加附件失败:', error)
      }
    }
  }, [makeUniqueFilename, setPendingFiles])

  /** 打开文件选择对话框 */
  const handleOpenFileDialog = React.useCallback(async (): Promise<void> => {
    try {
      const result = await window.electronAPI.openFileDialog()
      if (result.files.length === 0) return

      for (const fileInfo of result.files) {
        const previewUrl = fileInfo.mediaType.startsWith('image/')
          ? `data:${fileInfo.mediaType};base64,${fileInfo.data}`
          : undefined

        const pending: AgentPendingFile = {
          id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          filename: fileInfo.filename,
          mediaType: fileInfo.mediaType,
          size: fileInfo.size,
          previewUrl,
        }

        if (!window.__pendingAgentFileData) {
          window.__pendingAgentFileData = new Map<string, string>()
        }
        window.__pendingAgentFileData.set(pending.id, fileInfo.data)

        setPendingFiles((prev) => [...prev, pending])
      }
    } catch (error) {
      console.error('[AgentView] 文件选择对话框失败:', error)
    }
  }, [setPendingFiles])

  /** 打开文件夹选择对话框 */
  const handleOpenFolderDialog = React.useCallback(async (): Promise<void> => {
    if (!currentSessionId || !currentWorkspaceId || isUploadingFolder) return

    const workspace = workspaces.find((w) => w.id === currentWorkspaceId)
    if (!workspace) return

    try {
      const result = await window.electronAPI.openFolderDialog()
      if (!result) return

      setIsUploadingFolder(true)
      console.log(`[AgentView] 开始复制文件夹: ${result.path}`)

      const saved = await window.electronAPI.copyFolderToSession({
        sourcePath: result.path,
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        sessionId: currentSessionId,
      })

      setPendingFolderRefs((prev) => [...prev, ...saved])
      console.log(`[AgentView] 文件夹复制成功，共 ${saved.length} 个文件`)
    } catch (error) {
      console.error('[AgentView] 文件夹选择失败:', error)
      // 显示错误提示
      setAgentStreamErrors((prev) => {
        const map = new Map(prev)
        map.set(currentSessionId, `文件夹上传失败: ${error instanceof Error ? error.message : '未知错误'}`)
        return map
      })
    } finally {
      setIsUploadingFolder(false)
    }
  }, [currentSessionId, currentWorkspaceId, workspaces, isUploadingFolder, setAgentStreamErrors])

  /** 移除待发送文件 */
  const handleRemoveFile = React.useCallback((id: string): void => {
    setPendingFiles((prev) => {
      const file = prev.find((f) => f.id === id)
      if (file?.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(file.previewUrl)
      }
      window.__pendingAgentFileData?.delete(id)
      return prev.filter((f) => f.id !== id)
    })
  }, [setPendingFiles])

  /** 粘贴文件处理 */
  const handlePasteFiles = React.useCallback((files: File[]): void => {
    addFilesAsAttachments(files)
  }, [addFilesAsAttachments])

  /** 拖放处理 */
  const handleDragOver = React.useCallback((e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = React.useCallback((e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = React.useCallback(async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    const items = Array.from(e.dataTransfer.items)
    const regularFiles: File[] = []
    let hasFolders = false

    // 使用 webkitGetAsEntry 区分文件和文件夹
    for (const item of items) {
      if (item.kind !== 'file') continue
      const entry = item.webkitGetAsEntry?.()
      if (entry?.isDirectory) {
        // 检测到文件夹，显示警告
        hasFolders = true
        console.warn('[AgentView] 拖拽文件夹已禁用，请使用"添加文件夹"按钮')
      } else {
        const file = item.getAsFile()
        if (file) regularFiles.push(file)
      }
    }

    // 如果检测到文件夹，显示提示
    if (hasFolders) {
      setDragFolderWarning(true)
      setTimeout(() => setDragFolderWarning(false), 3000)
    }

    // 只处理普通文件
    if (regularFiles.length > 0) {
      addFilesAsAttachments(regularFiles)
    }
  }, [addFilesAsAttachments])

  /** ModelSelector 选择回调 */
  const handleModelSelect = React.useCallback((option: ModelOption): void => {
    setAgentChannelId(option.channelId)
    setAgentModelId(option.modelId)

    // 持久化到设置
    window.electronAPI.updateSettings({
      agentChannelId: option.channelId,
      agentModelId: option.modelId,
    }).catch(console.error)
  }, [setAgentChannelId, setAgentModelId])

  /** 构建 externalSelectedModel 给 ModelSelector */
  const externalSelectedModel = React.useMemo(() => {
    if (!agentChannelId) return null
    if (!agentModelId) return { channelId: agentChannelId, modelId: '' }
    return { channelId: agentChannelId, modelId: agentModelId }
  }, [agentChannelId, agentModelId])

  React.useEffect(() => {
    const query = extractMentionQuery(inputContent)
    // 每次输入变化先推进请求版本号，确保旧请求结果不会覆盖新状态
    const requestId = mentionRequestIdRef.current + 1
    mentionRequestIdRef.current = requestId

    if (query === null || !currentSessionId || !currentWorkspaceId) {
      setMentionOpen(false)
      setMentionQuery('')
      setMentionLoading(false)
      setMentionSuggestions([])
      setMentionActiveIndex(-1)
      return
    }

    setMentionOpen(true)
    setMentionQuery(query)
    setMentionLoading(true)

    const timer = setTimeout(() => {
      window.electronAPI.searchSessionFiles({
        workspaceId: currentWorkspaceId,
        sessionId: currentSessionId,
        query,
        limit: 20,
      }).then((items) => {
        if (mentionRequestIdRef.current !== requestId) return
        setMentionSuggestions(items)
        setMentionActiveIndex(items.length > 0 ? 0 : -1)
      }).catch((error) => {
        if (mentionRequestIdRef.current !== requestId) return
        console.warn('[AgentView] 搜索文件联想失败:', error)
        setMentionSuggestions([])
        setMentionActiveIndex(-1)
      }).finally(() => {
        if (mentionRequestIdRef.current === requestId) {
          setMentionLoading(false)
        }
      })
    }, 150)

    return () => clearTimeout(timer)
  }, [inputContent, currentSessionId, currentWorkspaceId])

  const handleSelectMention = React.useCallback((file: AgentFileSuggestion): void => {
    setMentionedFiles((prev) => {
      if (prev.some((item) => item.path === file.path)) {
        return prev
      }
      return [...prev, file]
    })
    setInputContent(removeTrailingMention(inputContent))
    setMentionOpen(false)
    setMentionQuery('')
    setMentionSuggestions([])
    setMentionActiveIndex(-1)
    setMentionLoading(false)
  }, [inputContent, setInputContent])

  const handleRemoveMentionedFile = React.useCallback((path: string): void => {
    setMentionedFiles((prev) => prev.filter((item) => item.path !== path))
  }, [])

  const handleClearMentionedFiles = React.useCallback((): void => {
    setMentionedFiles([])
  }, [])

  const handleMentionKeyDown = React.useCallback((event: KeyboardEvent): boolean => {
    if (!mentionOpen) return false

    if (event.key === 'Escape') {
      event.preventDefault()
      setMentionOpen(false)
      return true
    }

    if (event.key === 'ArrowDown') {
      if (mentionSuggestions.length === 0) return true
      event.preventDefault()
      setMentionActiveIndex((prev) => {
        if (prev < 0) return 0
        return (prev + 1) % mentionSuggestions.length
      })
      return true
    }

    if (event.key === 'ArrowUp') {
      if (mentionSuggestions.length === 0) return true
      event.preventDefault()
      setMentionActiveIndex((prev) => {
        if (prev <= 0) return mentionSuggestions.length - 1
        return prev - 1
      })
      return true
    }

    if (event.key === 'Enter') {
      if (mentionSuggestions.length === 0) return false
      event.preventDefault()
      const index = mentionActiveIndex >= 0 ? mentionActiveIndex : 0
      const file = mentionSuggestions[index]
      if (file) {
        handleSelectMention(file)
      }
      return true
    }

    return false
  }, [mentionOpen, mentionSuggestions, mentionActiveIndex, handleSelectMention])

  const buildAttachedFilesPrefix = React.useCallback((files: AgentSavedFile[]): string => {
    if (files.length === 0) return ''
    return `<attached_files>\n${files.map((file) => `- ${file.filename}: ${file.targetPath}`).join('\n')}\n</attached_files>\n\n`
  }, [])

  const cleanupPendingFiles = React.useCallback((): void => {
    for (const file of pendingFiles) {
      if (file.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(file.previewUrl)
      window.__pendingAgentFileData?.delete(file.id)
    }
    setPendingFiles([])
  }, [pendingFiles, setPendingFiles])

  /** 发送消息（直发，不排队） */
  const handleSend = React.useCallback(async (overrideText?: string): Promise<boolean> => {
    const baseText = (overrideText ?? inputContent).trim()
    const effectiveText = baseText || (overrideText ? '' : (suggestion || ''))

    if (
      (
        !effectiveText &&
        pendingFiles.length === 0 &&
        pendingFolderRefs.length === 0 &&
        mentionedFiles.length === 0
      ) ||
      !currentSessionId ||
      !agentChannelId
    ) {
      return false
    }

    if (streaming) {
      toast.error('请先停止当前回复后再发送')
      return false
    }

    const queueId = `agent-queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const workspace = workspaces.find((w) => w.id === currentWorkspaceId)
    const needsWorkspace = pendingFiles.length > 0 || pendingFolderRefs.length > 0 || mentionedFiles.length > 0
    if (needsWorkspace && !workspace) {
      toast.error('当前会话缺少工作区信息，无法保存队列附件')
      return false
    }

    const attachedByPath = new Map<string, AgentSavedFile>()
    const collectAttachedFiles = (files: AgentSavedFile[]): void => {
      for (const file of files) {
        if (!attachedByPath.has(file.targetPath)) {
          attachedByPath.set(file.targetPath, file)
        }
      }
    }

    try {
      if (pendingFiles.length > 0 && workspace) {
        const usedFilenames = new Set<string>()
        const filesToSave = pendingFiles.map((file) => {
          let uniqueName = file.filename
          if (usedFilenames.has(uniqueName)) {
            const dot = file.filename.lastIndexOf('.')
            const base = dot > 0 ? file.filename.slice(0, dot) : file.filename
            const ext = dot > 0 ? file.filename.slice(dot) : ''
            let index = 1
            uniqueName = `${base}-${index}${ext}`
            while (usedFilenames.has(uniqueName)) {
              index++
              uniqueName = `${base}-${index}${ext}`
            }
          }
          usedFilenames.add(uniqueName)
          return {
            filename: `.proma-queue/${queueId}/uploads/${uniqueName}`,
            data: window.__pendingAgentFileData?.get(file.id) || '',
          }
        })
        const savedUploads = await window.electronAPI.saveFilesToAgentSession({
          workspaceId: workspace.id,
          workspaceSlug: workspace.slug,
          sessionId: currentSessionId,
          files: filesToSave,
        })
        collectAttachedFiles(savedUploads)
      }

      const refsToSnapshot = new Map<string, string>()
      for (const file of pendingFolderRefs) {
        refsToSnapshot.set(file.targetPath, file.filename)
      }
      for (const file of mentionedFiles) {
        if (!refsToSnapshot.has(file.path)) {
          refsToSnapshot.set(file.path, file.relativePath)
        }
      }

      if (refsToSnapshot.size > 0 && workspace) {
        const snapshotInput: AgentSnapshotSessionFilesInput = {
          workspaceId: workspace.id,
          workspaceSlug: workspace.slug,
          sessionId: currentSessionId,
          queueId,
          files: Array.from(refsToSnapshot.entries()).map(([path, displayName]) => ({ path, displayName })),
        }
        const snapshotRefs = await window.electronAPI.snapshotSessionFiles(snapshotInput)
        collectAttachedFiles(snapshotRefs)
      }
    } catch (error) {
      console.error('[AgentView] 队列快照失败:', error)
      toast.error('保存队列快照失败，请重试')
      return false
    }

    const attachedFilesSnapshot = Array.from(attachedByPath.values())
    const finalMessage = `${buildAttachedFilesPrefix(attachedFilesSnapshot)}${effectiveText}`
    if (!finalMessage.trim()) return false

    setAgentStreamErrors((prev) => {
      if (!prev.has(currentSessionId)) return prev
      const map = new Map(prev)
      map.delete(currentSessionId)
      return map
    })
    setPromptSuggestions((prev) => {
      if (!prev.has(currentSessionId)) return prev
      const map = new Map(prev)
      map.delete(currentSessionId)
      return map
    })

    const input = {
      requestId: queueId,
      sessionId: currentSessionId,
      userMessage: finalMessage,
      channelId: agentChannelId,
      modelId: agentModelId || undefined,
      workspaceId: currentWorkspaceId || undefined,
    }

    cleanupPendingFiles()
    setPendingFolderRefs([])
    setMentionedFiles([])
    setInputContent('')

    setStreamingStates((prev) => {
      const map = new Map(prev)
      map.set(currentSessionId, {
        running: true,
        content: '',
        requestId: queueId,
        toolActivities: [],
        model: agentModelId || undefined,
        startedAt: Date.now(),
      })
      return map
    })

    const tempUserMsg: AgentMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: input.userMessage,
      createdAt: Date.now(),
    }
    setCurrentMessages((prev) => [...prev, tempUserMsg])

    try {
      await window.electronAPI.sendAgentMessage(input)
      return true
    } catch (error) {
      console.error('[AgentView] 发送失败:', error)
      setStreamingStates((prev) => {
        if (!prev.has(currentSessionId)) return prev
        const map = new Map(prev)
        map.delete(currentSessionId)
        return map
      })
      window.electronAPI
        .getAgentSessionMessages(currentSessionId)
        .then(setCurrentMessages)
        .catch(console.error)
      setAgentStreamErrors((prev) => {
        const map = new Map(prev)
        map.set(currentSessionId, error instanceof Error ? error.message : '发送失败')
        return map
      })
      return false
    }
  }, [
    inputContent,
    suggestion,
    pendingFiles,
    pendingFolderRefs,
    mentionedFiles,
    currentSessionId,
    agentChannelId,
    workspaces,
    currentWorkspaceId,
    buildAttachedFilesPrefix,
    agentModelId,
    streaming,
    setAgentStreamErrors,
    setPromptSuggestions,
    setStreamingStates,
    setCurrentMessages,
    cleanupPendingFiles,
    setInputContent,
  ])

  const handleSendClick = React.useCallback((): void => {
    void handleSend()
  }, [handleSend])

  // 自动发送 pending prompt（从设置页"对话完成配置"触发）
  React.useEffect(() => {
    if (!pendingPrompt) return
    if (!currentSessionId || pendingPrompt.sessionId !== currentSessionId) return
    if (!agentChannelId) return
    if (streaming) return

    const prompt = pendingPrompt
    void handleSend(prompt.message).then((sent) => {
      if (!sent) return
      setPendingPrompt((prev) => {
        if (!prev) return prev
        if (prev.sessionId !== prompt.sessionId) return prev
        if (prev.message !== prompt.message) return prev
        return null
      })
    })
  }, [pendingPrompt, currentSessionId, agentChannelId, streaming, setPendingPrompt, handleSend])

  /** 停止生成 */
  const handleStop = React.useCallback((): void => {
    if (!currentSessionId) return

    setStreamingStates((prev) => {
      const current = prev.get(currentSessionId)
      if (!current) return prev
      const map = new Map(prev)
      map.set(currentSessionId, { ...current, running: false })
      return map
    })

    window.electronAPI.stopAgent(currentSessionId).catch(console.error)
  }, [currentSessionId, setStreamingStates])

  /** 手动发送 /compact 命令 */
  const handleCompact = React.useCallback((): void => {
    if (!currentSessionId || !agentChannelId || streaming) return
    const compactRequestId = `agent-compact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // 初始化流式状态
    setStreamingStates((prev) => {
      const map = new Map(prev)
      const current = prev.get(currentSessionId) ?? {
        running: true,
        content: '',
        requestId: compactRequestId,
        toolActivities: [],
        model: agentModelId || undefined,
        startedAt: Date.now(),
      }
      map.set(currentSessionId, {
        ...current,
        running: true,
        requestId: compactRequestId,
        startedAt: current.startedAt ?? Date.now(),
      })
      return map
    })

    window.electronAPI.sendAgentMessage({
      requestId: compactRequestId,
      sessionId: currentSessionId,
      userMessage: '/compact',
      channelId: agentChannelId,
      modelId: agentModelId || undefined,
      workspaceId: currentWorkspaceId || undefined,
    }).catch(console.error)
  }, [currentSessionId, agentChannelId, agentModelId, currentWorkspaceId, streaming, setStreamingStates])

  /** 复制错误信息到剪贴板 */
  const handleCopyError = React.useCallback(async (): Promise<void> => {
    if (!agentError) return

    try {
      await navigator.clipboard.writeText(agentError)
      setErrorCopied(true)
      setTimeout(() => setErrorCopied(false), 2000)
    } catch (error) {
      console.error('[AgentView] 复制错误信息失败:', error)
    }
  }, [agentError])

  const canSend = (
    inputContent.trim().length > 0 ||
    pendingFiles.length > 0 ||
    pendingFolderRefs.length > 0 ||
    mentionedFiles.length > 0
  ) && agentChannelId !== null

  // 无当前会话 → 引导文案
  if (!currentSessionId) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full max-w-[min(72rem,100%)] mx-auto gap-4 text-muted-foreground" style={{ zoom: 1.1 }}>
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
          <Bot size={32} className="text-muted-foreground/60" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-lg font-medium text-foreground">Agent 模式</h2>
          <p className="text-sm max-w-[300px]">
            从左侧点击"新会话"按钮创建一个 Agent 会话
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* 主内容区域 */}
      <div className="flex flex-col h-full flex-1 min-w-0 max-w-[min(72rem,100%)] mx-auto">
        {/* Agent Header */}
        <AgentHeader />

        {/* 消息区域 */}
        <AgentMessages />

        {/* 拖拽文件夹警告 */}
        {dragFolderWarning && (
          <div className="mx-4 mb-2 px-4 py-2.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 text-sm flex items-center gap-2">
            <FolderPlus className="size-4 shrink-0" />
            <span className="flex-1">不支持拖拽文件夹，请使用"添加文件夹"按钮</span>
            <button
              type="button"
              className="shrink-0 p-0.5 rounded hover:bg-amber-500/10 transition-colors"
              onClick={() => setDragFolderWarning(false)}
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {/* 权限请求横幅 */}
        <PermissionBanner />

        {/* AskUserQuestion 交互式问答横幅 */}
        <AskUserBanner />

        {/* 输入区域 — 复用 Chat 的卡片式输入风格 */}
        <div className="px-2.5 pb-2.5 md:px-[18px] md:pb-[18px] pt-2">
          <div
            className={cn(
              'rounded-[17px] border-[0.5px] border-border bg-background/70 backdrop-blur-sm pt-2 transition-all duration-200',
              isDragOver && 'border-[2px] border-dashed border-[#2ecc71] bg-[#2ecc71]/[0.03]'
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {/* 无 Agent 渠道提示 */}
            {!agentChannelId && (
              <div className="flex items-center gap-2 px-4 py-2 text-sm text-amber-600 dark:text-amber-400">
                <Settings size={14} />
                <span>请在设置中选择 Agent 供应商</span>
                <button
                  type="button"
                  className="text-xs underline underline-offset-2 hover:text-foreground transition-colors"
                  onClick={() => setActiveView('settings')}
                >
                  前往设置
                </button>
              </div>
            )}

            {/* 附件预览区域 */}
            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 px-3 pb-1.5">
                {pendingFiles.map((file) => (
                  <AttachmentPreviewItem
                    key={file.id}
                    filename={file.filename}
                    mediaType={file.mediaType}
                    previewUrl={file.previewUrl}
                    onRemove={() => handleRemoveFile(file.id)}
                  />
                ))}
              </div>
            )}

            {/* 文件夹引用预览区域 */}
            {pendingFolderRefs.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-3 pb-1.5">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted text-xs text-muted-foreground">
                  <FolderPlus className="size-3.5" />
                  <span>已附加 {pendingFolderRefs.length} 个文件</span>
                  <button
                    type="button"
                    className="ml-1 text-muted-foreground/60 hover:text-foreground transition-colors"
                    onClick={() => setPendingFolderRefs([])}
                  >
                    ×
                  </button>
                </div>
              </div>
            )}

            {/* @ 文件引用预览区域 */}
            {mentionedFiles.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 px-3 pb-1.5">
                {mentionedFiles.map((file) => (
                  <div
                    key={file.path}
                    className="inline-flex items-center gap-1 rounded-md border bg-muted/50 px-2 py-1 text-xs text-foreground/80"
                  >
                    <FileText className="size-3 shrink-0 text-muted-foreground" />
                    <span className="max-w-[260px] truncate">{file.relativePath}</span>
                    <button
                      type="button"
                      className="text-muted-foreground/70 transition-colors hover:text-foreground"
                      onClick={() => handleRemoveMentionedFile(file.path)}
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                  onClick={handleClearMentionedFiles}
                >
                  清空引用
                </button>
              </div>
            )}

            {/* Agent 建议提示 */}
            {suggestion && !streaming && (
              <div className="px-3 pb-1.5">
                <button
                  type="button"
                  className="group flex items-start gap-2 w-full rounded-lg border border-dashed border-primary/30 bg-primary/[0.03] px-3 py-2.5 text-left text-sm transition-colors hover:border-primary/50 hover:bg-primary/[0.06]"
                  onClick={handleSendClick}
                >
                  <Sparkles className="size-4 shrink-0 mt-0.5 text-primary/60 group-hover:text-primary/80" />
                  <span className="flex-1 min-w-0 text-foreground/80 group-hover:text-foreground line-clamp-3">{suggestion}</span>
                  <X
                    className="size-3.5 shrink-0 mt-0.5 text-muted-foreground/40 hover:text-foreground transition-colors"
                    onClick={(e) => {
                      e.stopPropagation()
                      setPromptSuggestions((prev) => {
                        if (!currentSessionId || !prev.has(currentSessionId)) return prev
                        const map = new Map(prev)
                        map.delete(currentSessionId)
                        return map
                      })
                    }}
                  />
                </button>
              </div>
            )}

            <RichTextInput
              value={inputContent}
              onChange={setInputContent}
              onSubmit={handleSendClick}
              onPasteFiles={handlePasteFiles}
              onSpecialKeyDown={handleMentionKeyDown}
              onBlur={() => setMentionOpen(false)}
              placeholder={
                agentChannelId
                  ? '输入消息... (Enter 发送，Shift+Enter 换行)'
                  : '请先在设置中选择 Agent 供应商'
              }
              disabled={!agentChannelId}
              autoFocusTrigger={currentSessionId}
            />

            {/* @ 文件联想面板 */}
            {mentionOpen && (
              <div className="px-3 pb-1.5">
                <div className="max-h-52 overflow-y-auto rounded-md border bg-popover">
                  {mentionLoading ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">搜索文件中...</div>
                  ) : mentionSuggestions.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      {mentionQuery ? '未找到匹配文件' : '输入关键词筛选文件'}
                    </div>
                  ) : (
                    mentionSuggestions.map((item, index) => (
                      <button
                        key={item.path}
                        type="button"
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors',
                          index === mentionActiveIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
                        )}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleSelectMention(item)}
                      >
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{item.relativePath}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Footer 工具栏 */}
            <div className="flex items-center justify-between px-2 py-[5px] h-[40px] gap-4">
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                {agentChannelId && (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-[30px] rounded-full text-foreground/60 hover:text-foreground"
                          onClick={handleOpenFileDialog}
                        >
                          <Paperclip className="size-5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p>添加附件</p>
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-[30px] rounded-full text-foreground/60 hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={handleOpenFolderDialog}
                          disabled={isUploadingFolder}
                        >
                          <FolderPlus className="size-5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p>{isUploadingFolder ? '正在上传文件夹...' : '添加文件夹'}</p>
                      </TooltipContent>
                    </Tooltip>
                    <PermissionModeSelector />
                    <PermissionDefaultsSelector />
                    <ModelSelector
                      filterChannelId={agentChannelId}
                      externalSelectedModel={externalSelectedModel}
                      onModelSelect={handleModelSelect}
                    />
                    <ContextUsageBadge
                      inputTokens={contextStatus.inputTokens}
                      contextWindow={contextStatus.contextWindow}
                      isCompacting={contextStatus.isCompacting}
                      isProcessing={streaming}
                      onCompact={handleCompact}
                    />
                  </>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {streaming && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-[30px] rounded-full text-destructive hover:bg-destructive/10"
                    onClick={handleStop}
                  >
                    <Square className="size-[22px]" />
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    'size-[30px] rounded-full',
                    canSend
                      ? 'text-primary hover:bg-primary/10'
                      : 'text-foreground/30 cursor-not-allowed'
                  )}
                  onClick={handleSendClick}
                  disabled={!canSend}
                  title="发送"
                >
                  <CornerDownLeft className={cn(streaming ? 'size-[20px]' : 'size-[22px]')} />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 文件浏览器侧栏 — 始终渲染 w-10 占位，避免切换模式时布局跳动 */}
      <div
        className={cn(
          'relative flex-shrink-0 transition-[width] duration-300 ease-in-out overflow-hidden titlebar-drag-region',
          sessionPath && fileBrowserOpen ? 'w-[300px] border-l' : 'w-10'
        )}
      >
        {sessionPath && (
          <>
            {/* 切换按钮 — 始终固定在右上角，同一个 DOM 元素 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-2.5 top-2.5 z-10 h-7 w-7 titlebar-no-drag"
                  onClick={() => setFileBrowserOpen((prev) => !prev)}
                >
                  <FolderOpen
                    className={cn(
                      'size-3.5 absolute transition-all duration-200',
                      fileBrowserOpen ? 'opacity-0 rotate-90 scale-75' : 'opacity-100 rotate-0 scale-100'
                    )}
                  />
                  <X
                    className={cn(
                      'size-3.5 absolute transition-all duration-200',
                      fileBrowserOpen ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-75'
                    )}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                <p>{fileBrowserOpen ? '关闭文件浏览器' : '打开文件浏览器'}</p>
              </TooltipContent>
            </Tooltip>

            {/* FileBrowser 内容 — 收起时隐藏 */}
            <div className={cn(
              'w-[300px] h-full transition-opacity duration-300 titlebar-no-drag',
              fileBrowserOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
            )}>
              <FileBrowser rootPath={sessionPath} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
