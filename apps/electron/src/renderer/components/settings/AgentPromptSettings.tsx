/**
 * AgentPromptSettings - Agent 系统提示词管理设置区块
 *
 * 上方：提示词列表（选择/新建/删除/设为默认）
 * 下方：编辑区（名称 + 内容，内置只读）
 */

import * as React from 'react'
import { Plus, Trash2, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { SettingsSection, SettingsCard } from './primitives'
import {
  AGENT_BUILTIN_DEFAULT_ID,
  AGENT_BUILTIN_DEFAULT_PROMPT,
} from '@proma/shared'
import type {
  AgentSystemPrompt,
  AgentSystemPromptConfig,
  AgentSystemPromptCreateInput,
  AgentSystemPromptUpdateInput,
} from '@proma/shared'

/** 防抖保存延迟 (ms) */
const DEBOUNCE_DELAY = 500

const DEFAULT_CONFIG: AgentSystemPromptConfig = {
  prompts: [{ ...AGENT_BUILTIN_DEFAULT_PROMPT }],
  defaultPromptId: AGENT_BUILTIN_DEFAULT_ID,
}

export function AgentPromptSettings(): React.ReactElement {
  const [config, setConfig] = React.useState<AgentSystemPromptConfig>(DEFAULT_CONFIG)
  const [selectedId, setSelectedId] = React.useState<string>(AGENT_BUILTIN_DEFAULT_ID)
  const [editName, setEditName] = React.useState('')
  const [editContent, setEditContent] = React.useState('')
  const [hoveredId, setHoveredId] = React.useState<string | null>(null)

  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingUpdateRef = React.useRef<{
    id: string
    input: AgentSystemPromptUpdateInput
  } | null>(null)

  /** 当前选中的提示词 */
  const selectedPrompt = React.useMemo(
    () => config.prompts.find((p) => p.id === selectedId),
    [config.prompts, selectedId]
  )

  /** 初始加载配置 */
  React.useEffect(() => {
    window.electronAPI.getAgentSystemPromptConfig().then((cfg) => {
      setConfig(cfg)
      const id = cfg.defaultPromptId ?? AGENT_BUILTIN_DEFAULT_ID
      setSelectedId(id)
    }).catch(console.error)
  }, [])

  /** 选中提示词变化时，同步编辑字段 */
  React.useEffect(() => {
    if (selectedPrompt) {
      setEditName(selectedPrompt.name)
      setEditContent(selectedPrompt.content)
    }
  }, [selectedPrompt])

  /** 立即落盘当前待保存变更 */
  const flushPendingSave = React.useCallback(async (): Promise<void> => {
    const pending = pendingUpdateRef.current
    if (!pending) return

    pendingUpdateRef.current = null

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }

    try {
      const updated = await window.electronAPI.updateAgentSystemPrompt(pending.id, pending.input)
      setConfig((prev) => ({
        ...prev,
        prompts: prev.prompts.map((p) => (p.id === updated.id ? updated : p)),
      }))
    } catch (error) {
      console.error('[Agent 提示词设置] 保存失败:', error)
    }
  }, [])

  /** 清理防抖定时器（卸载前先落盘） */
  React.useEffect(() => {
    return () => {
      void flushPendingSave()
    }
  }, [flushPendingSave])

  /** 新建提示词 */
  const handleCreate = async (): Promise<void> => {
    const input: AgentSystemPromptCreateInput = {
      name: '新提示词',
      content: '',
    }
    try {
      const created = await window.electronAPI.createAgentSystemPrompt(input)
      setConfig((prev) => ({
        ...prev,
        prompts: [...prev.prompts, created],
      }))
      setSelectedId(created.id)
    } catch (error) {
      console.error('[Agent 提示词设置] 创建失败:', error)
    }
  }

  /** 删除提示词 */
  const handleDelete = async (id: string): Promise<void> => {
    try {
      await window.electronAPI.deleteAgentSystemPrompt(id)
      setConfig((prev) => {
        const newPrompts = prev.prompts.filter((p) => p.id !== id)
        const newDefaultId = prev.defaultPromptId === id ? AGENT_BUILTIN_DEFAULT_ID : prev.defaultPromptId
        return { ...prev, prompts: newPrompts, defaultPromptId: newDefaultId }
      })
      if (pendingUpdateRef.current?.id === id) {
        pendingUpdateRef.current = null
        if (debounceRef.current) {
          clearTimeout(debounceRef.current)
          debounceRef.current = null
        }
      }
      if (selectedId === id) {
        setSelectedId(AGENT_BUILTIN_DEFAULT_ID)
      }
    } catch (error) {
      console.error('[Agent 提示词设置] 删除失败:', error)
    }
  }

  /** 设为默认提示词 */
  const handleSetDefault = async (id: string): Promise<void> => {
    try {
      await window.electronAPI.setDefaultAgentPrompt(id)
      setConfig((prev) => ({ ...prev, defaultPromptId: id }))
    } catch (error) {
      console.error('[Agent 提示词设置] 设置默认失败:', error)
    }
  }

  /** 防抖自动保存 */
  const debounceSave = React.useCallback(
    (id: string, input: AgentSystemPromptUpdateInput): void => {
      const pending = pendingUpdateRef.current
      if (pending && pending.id === id) {
        pendingUpdateRef.current = {
          id,
          input: { ...pending.input, ...input },
        }
      } else {
        if (pending && pending.id !== id) {
          void flushPendingSave()
        }
        pendingUpdateRef.current = { id, input: { ...input } }
      }

      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        void flushPendingSave()
      }, DEBOUNCE_DELAY)
    },
    [flushPendingSave]
  )

  /** 名称变更 */
  const handleNameChange = (value: string): void => {
    setEditName(value)
    if (selectedPrompt && !selectedPrompt.isBuiltin) {
      debounceSave(selectedPrompt.id, { name: value })
    }
  }

  /** 内容变更 */
  const handleContentChange = (value: string): void => {
    setEditContent(value)
    if (selectedPrompt && !selectedPrompt.isBuiltin) {
      debounceSave(selectedPrompt.id, { content: value })
    }
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        title="系统提示词"
        description="管理 Agent 模式的系统提示词"
        action={
          <Button size="sm" onClick={handleCreate}>
            <Plus className="size-4 mr-1" />
            新建
          </Button>
        }
      >
        <SettingsCard divided={false} className="p-0">
          <div className="divide-y divide-border/50">
            {config.prompts.map((prompt) => (
              <AgentPromptListItem
                key={prompt.id}
                prompt={prompt}
                isSelected={prompt.id === selectedId}
                isDefault={prompt.id === config.defaultPromptId}
                isHovered={prompt.id === hoveredId}
                onSelect={setSelectedId}
                onDelete={handleDelete}
                onSetDefault={handleSetDefault}
                onHoverChange={setHoveredId}
              />
            ))}
          </div>
        </SettingsCard>
      </SettingsSection>

      {selectedPrompt && (
        <SettingsSection title="提示词内容">
          <SettingsCard divided={false} className="p-4 space-y-3">
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">名称</label>
              <Input
                value={editName}
                onChange={(e) => handleNameChange(e.target.value)}
                readOnly={selectedPrompt.isBuiltin}
                className={cn(selectedPrompt.isBuiltin && 'opacity-60 cursor-not-allowed')}
                maxLength={50}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">内容</label>
              <Textarea
                value={editContent}
                onChange={(e) => handleContentChange(e.target.value)}
                readOnly={selectedPrompt.isBuiltin}
                className={cn(
                  'min-h-[240px] resize-y',
                  selectedPrompt.isBuiltin && 'opacity-60 cursor-not-allowed'
                )}
                placeholder="输入 Agent 系统提示词内容..."
              />
            </div>
          </SettingsCard>
        </SettingsSection>
      )}
    </div>
  )
}

interface AgentPromptListItemProps {
  prompt: AgentSystemPrompt
  isSelected: boolean
  isDefault: boolean
  isHovered: boolean
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onSetDefault: (id: string) => void
  onHoverChange: (id: string | null) => void
}

function AgentPromptListItem({
  prompt,
  isSelected,
  isDefault,
  isHovered,
  onSelect,
  onDelete,
  onSetDefault,
  onHoverChange,
}: AgentPromptListItemProps): React.ReactElement {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-4 py-2.5 cursor-pointer transition-colors',
        isSelected ? 'bg-accent/50' : 'hover:bg-muted/50'
      )}
      onClick={() => onSelect(prompt.id)}
      onMouseEnter={() => onHoverChange(prompt.id)}
      onMouseLeave={() => onHoverChange(null)}
    >
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <span className="text-sm font-medium truncate">{prompt.name}</span>
        {prompt.isBuiltin && (
          <span className="text-xs text-muted-foreground shrink-0">(内置)</span>
        )}
        {isDefault && (
          <Star className="size-3.5 text-amber-500 fill-amber-500 shrink-0" />
        )}
      </div>

      {!isDefault && isHovered && (
        <button
          type="button"
          className="p-1 rounded hover:bg-muted transition-colors"
          onClick={(e) => {
            e.stopPropagation()
            void onSetDefault(prompt.id)
          }}
          title="设为默认"
        >
          <Star className="size-3.5 text-muted-foreground" />
        </button>
      )}
      {!prompt.isBuiltin && isHovered && (
        <button
          type="button"
          className="p-1 rounded hover:bg-destructive/10 transition-colors"
          onClick={(e) => {
            e.stopPropagation()
            void onDelete(prompt.id)
          }}
          title="删除"
        >
          <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
        </button>
      )}
    </div>
  )
}
