/**
 * ChatView - 主聊天视图容器
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { MessageSquare, AlertCircle, X } from 'lucide-react'
import { ChatHeader } from './ChatHeader'
import { ChatMessages } from './ChatMessages'
import { ChatInput } from './ChatInput'
import { PromptEditorSidebar } from './PromptEditorSidebar'
import type { InlineEditSubmitPayload } from './ChatMessageItem'
import {
  currentConversationIdAtom,
  currentConversationAtom,
  currentMessagesAtom,
  streamingAtom,
  streamingStatesAtom,
  selectedModelAtom,
  conversationsAtom,
  contextLengthAtom,
  contextDividersAtom,
  thinkingEnabledAtom,
  pendingAttachmentsAtom,
  hasMoreMessagesAtom,
  INITIAL_MESSAGE_LIMIT,
  chatStreamErrorsAtom,
  currentChatErrorAtom,
} from '@/atoms/chat-atoms'
import { resolvedSystemMessageAtom, promptSidebarOpenAtom } from '@/atoms/system-prompt-atoms'
import { cn } from '@/lib/utils'
import type { ConversationStreamState } from '@/atoms/chat-atoms'
import type {
  GenerateTitleInput,
  StreamChunkEvent,
  StreamReasoningEvent,
  StreamCompleteEvent,
  StreamErrorEvent,
  StreamToolActivityEvent,
  FileAttachment,
  AttachmentSaveInput,
} from '@proma/shared'

interface SendOptions {
  attachments?: FileAttachment[]
  consumePendingAttachments?: boolean
  cleanupAttachmentsOnError?: FileAttachment[]
  messageCountBeforeSend?: number
  contextDividersOverride?: string[]
}

export function ChatView(): React.ReactElement {
  const currentConversationId = useAtomValue(currentConversationIdAtom)
  const currentConversation = useAtomValue(currentConversationAtom)
  const [currentMessages, setCurrentMessages] = useAtom(currentMessagesAtom)
  const setStreamingStates = useSetAtom(streamingStatesAtom)
  const [selectedModel, setSelectedModel] = useAtom(selectedModelAtom)
  const setConversations = useSetAtom(conversationsAtom)
  const contextLength = useAtomValue(contextLengthAtom)
  const [contextDividers, setContextDividers] = useAtom(contextDividersAtom)
  const thinkingEnabled = useAtomValue(thinkingEnabledAtom)
  const [pendingAttachments, setPendingAttachments] = useAtom(pendingAttachmentsAtom)
  const setHasMoreMessages = useSetAtom(hasMoreMessagesAtom)
  const setChatStreamErrors = useSetAtom(chatStreamErrorsAtom)
  const chatError = useAtomValue(currentChatErrorAtom)
  const isStreaming = useAtomValue(streamingAtom)
  const resolvedSystemMessage = useAtomValue(resolvedSystemMessageAtom)
  const promptSidebarOpen = useAtomValue(promptSidebarOpenAtom)
  const [inlineEditingMessageId, setInlineEditingMessageId] = React.useState<string | null>(null)

  // 首条消息标题生成相关 ref（支持多对话并行）
  const pendingTitleRef = React.useRef<Map<string, GenerateTitleInput>>(new Map())

  // 当前对话 ID 的 ref，供 IPC 回调使用（避免闭包捕获旧值）
  const currentConvIdRef = React.useRef(currentConversationId)
  React.useEffect(() => {
    currentConvIdRef.current = currentConversationId
  }, [currentConversationId])

  React.useEffect(() => {
    setInlineEditingMessageId(null)
  }, [currentConversationId])

  const snapshotPendingAttachments = React.useCallback(async (conversationId: string): Promise<FileAttachment[]> => {
    if (pendingAttachments.length === 0) return []

    const currentAttachments = [...pendingAttachments]
    const savedAttachments: FileAttachment[] = []

    for (const att of currentAttachments) {
      const base64Data = window.__pendingAttachmentData?.get(att.id)
      if (!base64Data) continue

      try {
        const input: AttachmentSaveInput = {
          conversationId,
          filename: att.filename,
          mediaType: att.mediaType,
          data: base64Data,
        }
        const result = await window.electronAPI.saveAttachment(input)
        savedAttachments.push(result.attachment)
      } catch (error) {
        console.error('[ChatView] 保存附件失败:', error)
      }
    }

    for (const att of currentAttachments) {
      if (att.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(att.previewUrl)
      }
      window.__pendingAttachmentData?.delete(att.id)
    }
    setPendingAttachments([])

    return savedAttachments
  }, [pendingAttachments, setPendingAttachments])

  const cleanupAttachments = React.useCallback(async (attachments: FileAttachment[]): Promise<void> => {
    for (const attachment of attachments) {
      try {
        await window.electronAPI.deleteAttachment(attachment.localPath)
      } catch (error) {
        console.warn('[ChatView] 清理附件失败:', error)
      }
    }
  }, [])

  // 加载当前对话最近消息 + 上下文分隔线
  React.useEffect(() => {
    if (!currentConversationId) {
      setCurrentMessages([])
      setContextDividers([])
      setHasMoreMessages(false)
      return
    }

    window.electronAPI
      .getRecentMessages(currentConversationId, INITIAL_MESSAGE_LIMIT)
      .then((result) => {
        setCurrentMessages(result.messages)
        setHasMoreMessages(result.hasMore)
      })
      .catch(console.error)

    if (currentConversation?.contextDividers) {
      setContextDividers(currentConversation.contextDividers)
    } else {
      setContextDividers([])
    }

    if (currentConversation?.modelId && currentConversation?.channelId) {
      setSelectedModel({
        channelId: currentConversation.channelId,
        modelId: currentConversation.modelId,
      })
    }
  }, [
    currentConversationId,
    currentConversation?.contextDividers,
    currentConversation?.modelId,
    currentConversation?.channelId,
    setCurrentMessages,
    setContextDividers,
    setHasMoreMessages,
    setSelectedModel,
  ])

  // 订阅流式 IPC 事件（全局，不按 conversationId 过滤）
  React.useEffect(() => {
    const updateState = (
      convId: string,
      updater: (prev: ConversationStreamState) => ConversationStreamState
    ): void => {
      setStreamingStates((prev) => {
        const current = prev.get(convId) ?? {
          streaming: false,
          content: '',
          reasoning: '',
          model: undefined,
          toolActivities: [],
        }
        const next = updater(current)
        const map = new Map(prev)
        map.set(convId, next)
        return map
      })
    }

    const removeState = (convId: string): void => {
      setStreamingStates((prev) => {
        if (!prev.has(convId)) return prev
        const map = new Map(prev)
        map.delete(convId)
        return map
      })
    }

    const cleanupChunk = window.electronAPI.onStreamChunk((event: StreamChunkEvent) => {
      updateState(event.conversationId, (s) => ({
        ...s,
        content: s.content + event.delta,
      }))
    })

    const cleanupReasoning = window.electronAPI.onStreamReasoning((event: StreamReasoningEvent) => {
      updateState(event.conversationId, (s) => ({
        ...s,
        reasoning: s.reasoning + event.delta,
      }))
    })

    const cleanupComplete = window.electronAPI.onStreamComplete((event: StreamCompleteEvent) => {
      removeState(event.conversationId)

      if (event.conversationId === currentConvIdRef.current) {
        window.electronAPI
          .getConversationMessages(event.conversationId)
          .then((msgs) => {
            setCurrentMessages(msgs)
            setHasMoreMessages(false)
          })
          .catch(console.error)
      }

      window.electronAPI
        .listConversations()
        .then(setConversations)
        .catch(console.error)

      const titleInput = pendingTitleRef.current.get(event.conversationId)
      if (titleInput) {
        pendingTitleRef.current.delete(event.conversationId)
        window.electronAPI.generateTitle(titleInput).then((title) => {
          if (!title) return
          window.electronAPI
            .updateConversationTitle(event.conversationId, title)
            .then((updated) => {
              setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
            })
            .catch(console.error)
        }).catch((error) => {
          console.error('[ChatView] 标题生成失败:', error)
        })
      }
    })

    const cleanupError = window.electronAPI.onStreamError((event: StreamErrorEvent) => {
      console.error('[ChatView] 流式错误:', event.error)
      removeState(event.conversationId)

      setChatStreamErrors((prev) => {
        const map = new Map(prev)
        map.set(event.conversationId, event.error)
        return map
      })

      if (event.conversationId === currentConvIdRef.current) {
        window.electronAPI
          .getConversationMessages(event.conversationId)
          .then((msgs) => {
            setCurrentMessages(msgs)
            setHasMoreMessages(false)
          })
          .catch(console.error)
      }
    })

    const cleanupToolActivity = window.electronAPI.onStreamToolActivity((event: StreamToolActivityEvent) => {
      updateState(event.conversationId, (s) => ({
        ...s,
        toolActivities: [...s.toolActivities, event.activity],
      }))
    })

    return () => {
      cleanupChunk()
      cleanupReasoning()
      cleanupComplete()
      cleanupError()
      cleanupToolActivity()
    }
  }, [
    setStreamingStates,
    setCurrentMessages,
    setConversations,
    setHasMoreMessages,
    setChatStreamErrors,
  ])

  const syncContextDividers = React.useCallback(async (
    conversationId: string,
    messages: { id: string }[],
    currentDividers: string[],
  ): Promise<string[]> => {
    const messageIdSet = new Set(messages.map((msg) => msg.id))
    const newDividers = currentDividers.filter((id) => messageIdSet.has(id))
    if (newDividers.length !== currentDividers.length) {
      setContextDividers(newDividers)
      await window.electronAPI.updateContextDividers(conversationId, newDividers)
    }
    return newDividers
  }, [setContextDividers])

  /** 发送消息（直发，不排队） */
  const handleSend = React.useCallback(async (
    content: string,
    options?: SendOptions,
  ): Promise<boolean> => {
    if (!currentConversationId || !selectedModel) return false

    if (isStreaming) {
      toast.error('请先停止当前回复后再发送')
      return false
    }

    const trimmedContent = content.trim()
    const consumePending = options?.consumePendingAttachments ?? true
    let savedAttachments: FileAttachment[] = options?.attachments ?? []
    let cleanupAttachmentsOnError: FileAttachment[] = options?.cleanupAttachmentsOnError ?? []

    if (consumePending) {
      savedAttachments = await snapshotPendingAttachments(currentConversationId)
      cleanupAttachmentsOnError = savedAttachments
    }

    if (!trimmedContent && savedAttachments.length === 0) {
      return false
    }

    setChatStreamErrors((prev) => {
      if (!prev.has(currentConversationId)) return prev
      const map = new Map(prev)
      map.delete(currentConversationId)
      return map
    })

    const messageCountBeforeSend = options?.messageCountBeforeSend ?? currentMessages.length
    const isFirstMessage = messageCountBeforeSend === 0
    const titleInput = isFirstMessage && trimmedContent
      ? {
        userMessage: trimmedContent,
        channelId: selectedModel.channelId,
        modelId: selectedModel.modelId,
      }
      : undefined

    if (titleInput) {
      pendingTitleRef.current.set(currentConversationId, titleInput)
    }

    setStreamingStates((prev) => {
      const map = new Map(prev)
      map.set(currentConversationId, {
        streaming: true,
        content: '',
        reasoning: '',
        model: selectedModel.modelId,
        toolActivities: [],
      })
      return map
    })

    if (currentConversationId === currentConvIdRef.current) {
      setCurrentMessages((prev) => [
        ...prev,
        {
          id: `temp-${Date.now()}`,
          role: 'user',
          content: trimmedContent,
          createdAt: Date.now(),
          attachments: savedAttachments.length > 0 ? savedAttachments : undefined,
        },
      ])
    }

    const requestId = `chat-request-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    try {
      await window.electronAPI.sendMessage({
        requestId,
        conversationId: currentConversationId,
        userMessage: trimmedContent,
        messageHistory: [],
        channelId: selectedModel.channelId,
        modelId: selectedModel.modelId,
        contextLength,
        contextDividers: options?.contextDividersOverride ?? contextDividers,
        attachments: savedAttachments.length > 0 ? savedAttachments : undefined,
        thinkingEnabled: thinkingEnabled || undefined,
        systemMessage: resolvedSystemMessage,
      })
      return true
    } catch (error) {
      console.error('[ChatView] 发送失败:', error)
      pendingTitleRef.current.delete(currentConversationId)

      setStreamingStates((prev) => {
        if (!prev.has(currentConversationId)) return prev
        const map = new Map(prev)
        map.delete(currentConversationId)
        return map
      })

      if (currentConversationId === currentConvIdRef.current) {
        window.electronAPI
          .getConversationMessages(currentConversationId)
          .then((msgs) => {
            setCurrentMessages(msgs)
            setHasMoreMessages(false)
          })
          .catch(console.error)
      }

      await cleanupAttachments(cleanupAttachmentsOnError)
      setChatStreamErrors((prev) => {
        const map = new Map(prev)
        map.set(currentConversationId, error instanceof Error ? error.message : '发送失败')
        return map
      })
      return false
    }
  }, [
    currentConversationId,
    selectedModel,
    isStreaming,
    snapshotPendingAttachments,
    setChatStreamErrors,
    currentMessages.length,
    setStreamingStates,
    setCurrentMessages,
    contextLength,
    contextDividers,
    thinkingEnabled,
    resolvedSystemMessage,
    setHasMoreMessages,
    cleanupAttachments,
  ])

  /** 从某条消息起截断（包含该条） */
  const truncateFromMessage = React.useCallback(async (
    messageId: string,
    preserveFirstMessageAttachments = false,
  ): Promise<{
    targetAttachments: FileAttachment[]
    messageCountBeforeSend: number
    contextDividersAfterTruncate: string[]
  }> => {
    if (!currentConversationId) {
      return {
        targetAttachments: [],
        messageCountBeforeSend: 0,
        contextDividersAfterTruncate: [],
      }
    }

    const target = currentMessages.find((msg) => msg.id === messageId)
    const targetIndex = currentMessages.findIndex((msg) => msg.id === messageId)
    const targetAttachments = target?.attachments ?? []
    const updatedMessages = await window.electronAPI.truncateMessagesFrom(
      currentConversationId,
      messageId,
      preserveFirstMessageAttachments,
    )
    setCurrentMessages(updatedMessages)
    setHasMoreMessages(false)
    if (inlineEditingMessageId && inlineEditingMessageId !== messageId) {
      const stillExists = updatedMessages.some((msg) => msg.id === inlineEditingMessageId)
      if (!stillExists) {
        setInlineEditingMessageId(null)
      }
    }
    const contextDividersAfterTruncate = await syncContextDividers(currentConversationId, updatedMessages, contextDividers)
    return {
      targetAttachments,
      messageCountBeforeSend: targetIndex >= 0 ? targetIndex : updatedMessages.length,
      contextDividersAfterTruncate,
    }
  }, [
    currentConversationId,
    currentMessages,
    contextDividers,
    setCurrentMessages,
    setHasMoreMessages,
    inlineEditingMessageId,
    syncContextDividers,
  ])

  /** 停止生成 */
  const handleStop = React.useCallback((): void => {
    if (!currentConversationId) return

    setStreamingStates((prev) => {
      const current = prev.get(currentConversationId)
      if (!current) return prev
      const map = new Map(prev)
      map.set(currentConversationId, { ...current, streaming: false })
      return map
    })

    window.electronAPI.stopGeneration(currentConversationId).catch(console.error)
  }, [currentConversationId, setStreamingStates])

  /** 删除消息 */
  const handleDeleteMessage = async (messageId: string): Promise<void> => {
    if (!currentConversationId) return

    try {
      const updatedMessages = await window.electronAPI.deleteMessage(
        currentConversationId,
        messageId
      )
      setCurrentMessages(updatedMessages)
      if (inlineEditingMessageId === messageId) {
        setInlineEditingMessageId(null)
      }
      await syncContextDividers(currentConversationId, updatedMessages, contextDividers)
    } catch (error) {
      console.error('[ChatView] 删除消息失败:', error)
    }
  }

  /** 重新发送：从该用户消息分叉后，直接重发 */
  const handleResendMessage = React.useCallback(async (message: { id: string; content: string }): Promise<void> => {
    if (!currentConversationId || isStreaming) return

    try {
      const truncated = await truncateFromMessage(message.id, true)
      await handleSend(message.content, {
        attachments: truncated.targetAttachments,
        consumePendingAttachments: false,
        messageCountBeforeSend: truncated.messageCountBeforeSend,
        contextDividersOverride: truncated.contextDividersAfterTruncate,
      })
    } catch (error) {
      console.error('[ChatView] 重新发送失败:', error)
    }
  }, [currentConversationId, isStreaming, truncateFromMessage, handleSend])

  /** 开始原地编辑 */
  const handleStartInlineEdit = React.useCallback((message: { id: string }): void => {
    if (isStreaming) return
    setInlineEditingMessageId(message.id)
  }, [isStreaming])

  /** 取消原地编辑 */
  const handleCancelInlineEdit = React.useCallback((): void => {
    setInlineEditingMessageId(null)
  }, [])

  /** 提交原地编辑并重发（删除该消息及其后续） */
  const handleSubmitInlineEdit = React.useCallback(async (
    message: { id: string; content: string },
    payload: InlineEditSubmitPayload,
  ): Promise<void> => {
    if (!currentConversationId || isStreaming) return
    const trimmed = payload.content.trim()
    if (!trimmed && payload.keepExistingAttachments.length === 0 && payload.newAttachments.length === 0) return

    try {
      const truncated = await truncateFromMessage(message.id, true)
      const keepLocalPathSet = new Set(payload.keepExistingAttachments.map((att) => att.localPath))
      const removedOldAttachments = truncated.targetAttachments.filter(
        (att) => !keepLocalPathSet.has(att.localPath),
      )
      for (const removed of removedOldAttachments) {
        await window.electronAPI.deleteAttachment(removed.localPath)
      }

      const newSavedAttachments: FileAttachment[] = []
      for (const newAttachment of payload.newAttachments) {
        const input: AttachmentSaveInput = {
          conversationId: currentConversationId,
          filename: newAttachment.filename,
          mediaType: newAttachment.mediaType,
          data: newAttachment.data,
        }
        const result = await window.electronAPI.saveAttachment(input)
        newSavedAttachments.push(result.attachment)
      }

      await handleSend(trimmed, {
        attachments: [...payload.keepExistingAttachments, ...newSavedAttachments],
        cleanupAttachmentsOnError: newSavedAttachments,
        consumePendingAttachments: false,
        messageCountBeforeSend: truncated.messageCountBeforeSend,
        contextDividersOverride: truncated.contextDividersAfterTruncate,
      })
      setInlineEditingMessageId(null)
    } catch (error) {
      console.error('[ChatView] 原地编辑重发失败:', error)
    }
  }, [currentConversationId, isStreaming, truncateFromMessage, handleSend])

  /** 清除上下文（toggle 最后消息的分隔线） */
  const handleClearContext = React.useCallback((): void => {
    if (!currentConversationId || currentMessages.length === 0) return

    const lastMessage = currentMessages[currentMessages.length - 1]!
    const lastMessageId = lastMessage.id

    let newDividers: string[]
    if (contextDividers.includes(lastMessageId)) {
      newDividers = contextDividers.filter((id) => id !== lastMessageId)
    } else {
      newDividers = [...contextDividers, lastMessageId]
    }

    setContextDividers(newDividers)
    window.electronAPI
      .updateContextDividers(currentConversationId, newDividers)
      .catch(console.error)
  }, [currentConversationId, currentMessages, contextDividers, setContextDividers])

  /** 删除分隔线 */
  const handleDeleteDivider = React.useCallback((messageId: string): void => {
    if (!currentConversationId) return

    const newDividers = contextDividers.filter((id) => id !== messageId)
    setContextDividers(newDividers)
    window.electronAPI
      .updateContextDividers(currentConversationId, newDividers)
      .catch(console.error)
  }, [currentConversationId, contextDividers, setContextDividers])

  /** 加载全部历史消息（向上滚动时触发） */
  const handleLoadMore = React.useCallback(async (): Promise<void> => {
    if (!currentConversationId) return

    const allMessages = await window.electronAPI.getConversationMessages(currentConversationId)
    setCurrentMessages(allMessages)
    setHasMoreMessages(false)
  }, [currentConversationId, setCurrentMessages, setHasMoreMessages])

  if (!currentConversationId) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full max-w-[min(72rem,100%)] mx-auto gap-4 text-muted-foreground" style={{ zoom: 1.1 }}>
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
          <MessageSquare size={32} className="text-muted-foreground/60" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-lg font-medium text-foreground">开始对话</h2>
          <p className="text-sm max-w-[300px]">
            从左侧点击"新对话"按钮创建一个新对话
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex flex-col h-full flex-1 min-w-0">
        <ChatHeader />
        <div className="flex flex-col flex-1 w-full max-w-[min(72rem,100%)] mx-auto overflow-hidden min-h-0">
          <ChatMessages
            onDeleteMessage={handleDeleteMessage}
            onResendMessage={handleResendMessage}
            onStartInlineEdit={handleStartInlineEdit}
            onSubmitInlineEdit={handleSubmitInlineEdit}
            onCancelInlineEdit={handleCancelInlineEdit}
            inlineEditingMessageId={inlineEditingMessageId}
            onDeleteDivider={handleDeleteDivider}
            onLoadMore={handleLoadMore}
          />

          {chatError && (
            <div className="mx-4 mb-2 px-4 py-2.5 rounded-lg bg-destructive/10 text-destructive text-sm flex items-center gap-2">
              <AlertCircle className="size-4 shrink-0" />
              <span className="flex-1 break-all">{chatError}</span>
              <button
                type="button"
                className="shrink-0 p-0.5 rounded hover:bg-destructive/10 transition-colors"
                onClick={() => {
                  if (!currentConversationId) return
                  setChatStreamErrors((prev) => {
                    const map = new Map(prev)
                    map.delete(currentConversationId)
                    return map
                  })
                }}
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}

          <ChatInput
            onSend={handleSend}
            onStop={handleStop}
            onClearContext={handleClearContext}
          />
        </div>
      </div>

      <div className={cn(
        'relative flex-shrink-0 transition-[width] duration-300 ease-in-out overflow-hidden titlebar-drag-region',
        promptSidebarOpen ? 'w-[300px] border-l' : 'w-10'
      )}>
        <div className={cn(
          'w-[300px] h-full transition-opacity duration-200 titlebar-no-drag',
          promptSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}>
          <PromptEditorSidebar />
        </div>
      </div>
    </div>
  )
}
