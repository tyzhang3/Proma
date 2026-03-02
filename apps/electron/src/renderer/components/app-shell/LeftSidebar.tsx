/**
 * LeftSidebar - 左侧导航栏
 *
 * 包含：
 * - 工作区选择器
 * - 对话列表（新会话按钮 + 右键菜单 + 按 updatedAt 降序排列）
 * - 工作区能力指示器
 * - 设置项
 */

import * as React from 'react'
import { useAtom, useSetAtom, useAtomValue } from 'jotai'
import { Settings, Plus, Trash2, Pencil, Plug, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { activeViewAtom } from '@/atoms/active-view'
import { settingsTabAtom } from '@/atoms/settings-tab'
import {
  agentSessionsAtom,
  currentAgentSessionIdAtom,
  agentRunningSessionIdsAtom,
  agentChannelIdAtom,
  currentAgentWorkspaceIdAtom,
  agentWorkspacesAtom,
  workspaceCapabilitiesVersionAtom,
} from '@/atoms/agent-atoms'
import { userProfileAtom } from '@/atoms/user-profile'
import { hasUpdateAtom } from '@/atoms/updater'
import { hasEnvironmentIssuesAtom } from '@/atoms/environment'
import { WorkspaceSelector } from '@/components/agent/WorkspaceSelector'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import type { ActiveView } from '@/atoms/active-view'
import type { AgentSessionMeta, WorkspaceCapabilities } from '@proma/shared'

interface SidebarItemProps {
  icon: React.ReactNode
  label: string
  active?: boolean
  /** 右侧额外元素（如展开/收起箭头） */
  suffix?: React.ReactNode
  onClick?: () => void
}

function SidebarItem({ icon, label, active, suffix, onClick }: SidebarItemProps): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center justify-between px-3 py-2 rounded-[10px] text-[13px] transition-colors duration-100 titlebar-no-drag',
        active
          ? 'bg-foreground/[0.08] dark:bg-foreground/[0.08] text-foreground shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
          : 'text-foreground/60 hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.04] hover:text-foreground'
      )}
    >
      <div className="flex items-center gap-3">
        <span className="flex-shrink-0 w-[18px] h-[18px]">{icon}</span>
        <span>{label}</span>
      </div>
      {suffix}
    </button>
  )
}

export interface LeftSidebarProps {
  /** 可选固定宽度，默认使用 CSS 响应式宽度 */
  width?: number
}

/** 侧边栏导航项标识 */
type SidebarItemId = 'all-sessions' | 'settings'

/** 导航项到视图的映射 */
const ITEM_TO_VIEW: Record<SidebarItemId, ActiveView> = {
  'all-sessions': 'conversations',
  settings: 'settings',
}

/** 日期分组标签 */
type DateGroup = '今天' | '昨天' | '更早'

/** 按 updatedAt 将项目分为 今天 / 昨天 / 更早 三组 */
function groupByDate<T extends { updatedAt: number }>(items: T[]): Array<{ label: DateGroup; items: T[] }> {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86_400_000

  const today: T[] = []
  const yesterday: T[] = []
  const earlier: T[] = []

  for (const item of items) {
    if (item.updatedAt >= todayStart) {
      today.push(item)
    } else if (item.updatedAt >= yesterdayStart) {
      yesterday.push(item)
    } else {
      earlier.push(item)
    }
  }

  const groups: Array<{ label: DateGroup; items: T[] }> = []
  if (today.length > 0) groups.push({ label: '今天', items: today })
  if (yesterday.length > 0) groups.push({ label: '昨天', items: yesterday })
  if (earlier.length > 0) groups.push({ label: '更早', items: earlier })
  return groups
}

export function LeftSidebar({ width }: LeftSidebarProps): React.ReactElement {
  const [activeView, setActiveView] = useAtom(activeViewAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const [activeItem, setActiveItem] = React.useState<SidebarItemId>('all-sessions')
  const [hoveredId, setHoveredId] = React.useState<string | null>(null)
  /** 待删除对话 ID，非空时显示确认弹窗 */
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null)
  const setUserProfile = useSetAtom(userProfileAtom)
  const hasUpdate = useAtomValue(hasUpdateAtom)
  const hasEnvironmentIssues = useAtomValue(hasEnvironmentIssuesAtom)

  // Agent 模式状态
  const [agentSessions, setAgentSessions] = useAtom(agentSessionsAtom)
  const [currentAgentSessionId, setCurrentAgentSessionId] = useAtom(currentAgentSessionIdAtom)
  const agentRunningIds = useAtomValue(agentRunningSessionIdsAtom)
  const agentChannelId = useAtomValue(agentChannelIdAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)

  // 工作区能力（MCP + Skill 计数）
  const [capabilities, setCapabilities] = React.useState<WorkspaceCapabilities | null>(null)
  const capabilitiesVersion = useAtomValue(workspaceCapabilitiesVersionAtom)

  const currentWorkspaceSlug = React.useMemo(() => {
    if (!currentWorkspaceId) return null
    return workspaces.find((w) => w.id === currentWorkspaceId)?.slug ?? null
  }, [currentWorkspaceId, workspaces])

  React.useEffect(() => {
    if (!currentWorkspaceSlug) {
      setCapabilities(null)
      return
    }
    window.electronAPI
      .getWorkspaceCapabilities(currentWorkspaceSlug)
      .then(setCapabilities)
      .catch(console.error)
  }, [currentWorkspaceSlug, activeView, capabilitiesVersion])

  // 初始加载用户档案 + Agent 会话
  React.useEffect(() => {
    window.electronAPI
      .getUserProfile()
      .then(setUserProfile)
      .catch(console.error)
    window.electronAPI
      .listAgentSessions()
      .then(setAgentSessions)
      .catch(console.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setAgentSessions, setUserProfile])

  /** 处理导航项点击 */
  const handleItemClick = (item: SidebarItemId): void => {
    setActiveItem(item)
    setActiveView(ITEM_TO_VIEW[item])
  }

  // 当 activeView 从外部改变时，同步 activeItem
  React.useEffect(() => {
    if (activeView === 'conversations' && activeItem === 'settings') {
      setActiveItem('all-sessions')
    }
  }, [activeView, activeItem])

  /** 确认删除对话 */
  const handleConfirmDelete = async (): Promise<void> => {
    if (!pendingDeleteId) return

    // 删除 Agent 会话
    try {
      await window.electronAPI.deleteAgentSession(pendingDeleteId)
      setAgentSessions((prev) => prev.filter((s) => s.id !== pendingDeleteId))
      if (currentAgentSessionId === pendingDeleteId) {
        setCurrentAgentSessionId(null)
      }
    } catch (error) {
      console.error('[侧边栏] 删除 Agent 会话失败:', error)
    } finally {
      setPendingDeleteId(null)
    }
  }

  /** 创建新 Agent 会话 */
  const handleNewAgentSession = async (): Promise<void> => {
    try {
      const meta = await window.electronAPI.createAgentSession(
        undefined,
        agentChannelId || undefined,
        currentWorkspaceId || undefined,
      )
      setAgentSessions((prev) => [meta, ...prev])
      setCurrentAgentSessionId(meta.id)
      setActiveView('conversations')
      setActiveItem('all-sessions')
    } catch (error) {
      console.error('[侧边栏] 创建 Agent 会话失败:', error)
    }
  }

  /** 选择 Agent 会话 */
  const handleSelectAgentSession = (id: string): void => {
    setCurrentAgentSessionId(id)
    setActiveView('conversations')
    setActiveItem('all-sessions')
  }

  /** 请求删除会话（弹出确认框） */
  const handleRequestDelete = (id: string): void => {
    setPendingDeleteId(id)
  }

  /** 重命名 Agent 会话标题 */
  const handleAgentRename = async (id: string, newTitle: string): Promise<void> => {
    try {
      await window.electronAPI.updateAgentSessionTitle(id, newTitle)
      setAgentSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, title: newTitle, updatedAt: Date.now() } : s))
      )
    } catch (error) {
      console.error('[侧边栏] 重命名 Agent 会话失败:', error)
    }
  }

  /** Agent 会话按工作区过滤 */
  const filteredAgentSessions = React.useMemo(
    () => agentSessions.filter((s) => s.workspaceId === currentWorkspaceId),
    [agentSessions, currentWorkspaceId]
  )

  /** Agent 会话按日期分组 */
  const agentSessionGroups = React.useMemo(
    () => groupByDate(filteredAgentSessions),
    [filteredAgentSessions]
  )

  return (
    <div
      className="h-full flex flex-col bg-background"
      style={{ width: width ?? 280, minWidth: 180, flexShrink: 1 }}
    >
      {/* 顶部留空，避开 macOS 红绿灯 */}
      <div className="pt-[50px]">
        {/* 工作区选择器 */}
        <div className="px-3 pt-3">
          <WorkspaceSelector />
        </div>
      </div>

      {/* 新会话按钮 */}
      <div className="px-3 pt-2">
        <button
          onClick={handleNewAgentSession}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-[10px] text-[13px] font-medium text-foreground/70 bg-foreground/[0.04] hover:bg-foreground/[0.08] transition-colors duration-100 titlebar-no-drag border border-dashed border-foreground/10 hover:border-foreground/20"
        >
          <Plus size={14} />
          <span>新会话</span>
        </button>
      </div>

      {/* 列表区域 */}
      <div className="flex-1 overflow-y-auto px-3 pt-2 pb-3 scrollbar-none">
        {agentSessionGroups.map((group) => (
          <div key={group.label} className="mb-1">
            <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-foreground/40 select-none">
              {group.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {group.items.map((session) => (
                <AgentSessionItem
                  key={session.id}
                  session={session}
                  active={session.id === currentAgentSessionId}
                  hovered={session.id === hoveredId}
                  running={agentRunningIds.has(session.id)}
                  onSelect={() => handleSelectAgentSession(session.id)}
                  onRequestDelete={() => handleRequestDelete(session.id)}
                  onRename={handleAgentRename}
                  onMouseEnter={() => setHoveredId(session.id)}
                  onMouseLeave={() => setHoveredId(null)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 工作区能力指示器 */}
      {capabilities && (
        <div className="px-3 pb-1">
          <button
            onClick={() => { setSettingsTab('agent'); handleItemClick('settings') }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-[10px] text-[12px] text-foreground/50 hover:bg-foreground/[0.04] hover:text-foreground/70 transition-colors titlebar-no-drag"
          >
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <span className="flex items-center gap-1">
                <Plug size={13} className="text-foreground/40" />
                <span className="tabular-nums">{capabilities.mcpServers.filter((s) => s.enabled).length}</span>
                <span className="text-foreground/30">MCP</span>
              </span>
              <span className="text-foreground/20">·</span>
              <span className="flex items-center gap-1">
                <Zap size={13} className="text-foreground/40" />
                <span className="tabular-nums">{capabilities.skills.length}</span>
                <span className="text-foreground/30">Skills</span>
              </span>
            </div>
          </button>
        </div>
      )}

      {/* 底部设置 */}
      <div className="px-3 pb-3">
        <SidebarItem
          icon={<Settings size={18} />}
          label="设置"
          active={activeItem === 'settings'}
          onClick={() => handleItemClick('settings')}
          suffix={
            (hasUpdate || hasEnvironmentIssues) ? (
              <span className="w-2 h-2 rounded-full bg-red-500" />
            ) : undefined
          }
        />
      </div>

      {/* 删除确认弹窗 */}
      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteId(null) }}
      >
        <AlertDialogContent
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleConfirmDelete()
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除会话</AlertDialogTitle>
            <AlertDialogDescription>
              删除后将无法恢复，确定要删除这个会话吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ===== Agent 会话列表项 =====

interface AgentSessionItemProps {
  session: AgentSessionMeta
  active: boolean
  hovered: boolean
  running: boolean
  onSelect: () => void
  onRequestDelete: () => void
  onRename: (id: string, newTitle: string) => Promise<void>
  onMouseEnter: () => void
  onMouseLeave: () => void
}

function AgentSessionItem({
  session,
  active,
  hovered,
  running,
  onSelect,
  onRequestDelete,
  onRename,
  onMouseEnter,
  onMouseLeave,
}: AgentSessionItemProps): React.ReactElement {
  const [editing, setEditing] = React.useState(false)
  const [editTitle, setEditTitle] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)
  const justStartedEditing = React.useRef(false)

  const startEdit = (): void => {
    setEditTitle(session.title)
    setEditing(true)
    justStartedEditing.current = true
    setTimeout(() => {
      justStartedEditing.current = false
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 300)
  }

  const saveTitle = async (): Promise<void> => {
    if (justStartedEditing.current) return
    const trimmed = editTitle.trim()
    if (!trimmed || trimmed === session.title) {
      setEditing(false)
      return
    }
    await onRename(session.id, trimmed)
    setEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveTitle()
    } else if (e.key === 'Escape') {
      setEditing(false)
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          onClick={onSelect}
          onDoubleClick={(e) => {
            e.stopPropagation()
            startEdit()
          }}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-[7px] rounded-[10px] transition-colors duration-100 titlebar-no-drag text-left',
            active
              ? 'bg-foreground/[0.08] dark:bg-foreground/[0.08] shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
              : 'hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.04]'
          )}
        >
          <div className="flex-1 min-w-0">
            {editing ? (
              <input
                ref={inputRef}
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={saveTitle}
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-transparent text-[13px] leading-5 text-foreground border-b border-primary/50 outline-none px-0 py-0"
                maxLength={100}
              />
            ) : (
              <div className={cn(
                'truncate text-[13px] leading-5 flex items-center gap-1.5',
                active ? 'text-foreground' : 'text-foreground/80'
              )}>
                {running && (
                  <span className="relative flex-shrink-0 size-4 flex items-center justify-center">
                    <span className="absolute size-2 rounded-full bg-blue-500/60 animate-ping" />
                    <span className="relative block size-2 rounded-full bg-blue-500" />
                  </span>
                )}
                <span className="truncate">{session.title}</span>
              </div>
            )}
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation()
              onRequestDelete()
            }}
            className={cn(
              'flex-shrink-0 p-1 rounded-md text-foreground/30 hover:bg-destructive/10 hover:text-destructive transition-all duration-100',
              hovered && !editing ? 'opacity-100' : 'opacity-0 pointer-events-none'
            )}
            title="删除会话"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-40">
        <ContextMenuItem
          className="gap-2 text-[13px]"
          onSelect={startEdit}
        >
          <Pencil size={14} />
          重命名
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="gap-2 text-[13px] text-destructive focus:text-destructive"
          onSelect={onRequestDelete}
        >
          <Trash2 size={14} />
          删除会话
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
