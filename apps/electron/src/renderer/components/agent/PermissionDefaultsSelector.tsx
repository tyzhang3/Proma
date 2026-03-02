/**
 * PermissionDefaultsSelector — Agent 默认放行开关
 *
 * 在 smart 模式下，允许按工作区配置默认放行执行类/写入类工具。
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { ShieldCheck } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  agentPermissionModeAtom,
  agentPermissionDefaultsAtom,
  currentAgentWorkspaceIdAtom,
  agentWorkspacesAtom,
} from '@/atoms/agent-atoms'
import type { WorkspacePermissionDefaults } from '@proma/shared'

export function PermissionDefaultsSelector(): React.ReactElement | null {
  const mode = useAtomValue(agentPermissionModeAtom)
  const [defaults, setDefaults] = useAtom(agentPermissionDefaultsAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const disabled = mode !== 'smart'

  const workspaceSlug = React.useMemo(() => {
    if (!currentWorkspaceId) return null
    const ws = workspaces.find((w) => w.id === currentWorkspaceId)
    return ws?.slug ?? null
  }, [currentWorkspaceId, workspaces])

  React.useEffect(() => {
    if (!workspaceSlug) return
    let cancelled = false

    window.electronAPI.getPermissionDefaults(workspaceSlug)
      .then((savedDefaults) => {
        if (cancelled) return
        setDefaults(savedDefaults)
      })
      .catch((error) => {
        if (cancelled) return
        console.error('[PermissionDefaultsSelector] 加载默认放行配置失败:', error)
      })

    return () => {
      cancelled = true
    }
  }, [workspaceSlug, setDefaults])

  const updateDefaults = React.useCallback(async (
    patch: Partial<WorkspacePermissionDefaults>
  ) => {
    if (!workspaceSlug) return
    const next = { ...defaults, ...patch }
    const prev = defaults
    setDefaults(next)

    try {
      await window.electronAPI.setPermissionDefaults(workspaceSlug, next)
    } catch (error) {
      setDefaults(prev)
      console.error('[PermissionDefaultsSelector] 保存默认放行配置失败:', error)
    }
  }, [workspaceSlug, defaults, setDefaults])

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 px-1.5 py-1 rounded text-xs font-medium transition-colors text-foreground/70 hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!workspaceSlug}
        >
          <ShieldCheck className="size-3.5" />
          <span className="hidden sm:inline">默认放行</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-[260px] p-3 space-y-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">默认放行（当前工作区）</p>
          <p className="text-xs text-muted-foreground">
            smart 模式下可跳过常见确认弹窗
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className={cn('text-sm', disabled && 'text-muted-foreground')}>默认允许执行</p>
              <p className="text-xs text-muted-foreground">Bash / Task / mcp__*</p>
            </div>
            <Switch
              checked={defaults.allowExecute}
              disabled={disabled}
              onCheckedChange={(checked) => { void updateDefaults({ allowExecute: checked }) }}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className={cn('text-sm', disabled && 'text-muted-foreground')}>默认允许写入</p>
              <p className="text-xs text-muted-foreground">Write / Edit / NotebookEdit</p>
            </div>
            <Switch
              checked={defaults.allowWrite}
              disabled={disabled}
              onCheckedChange={(checked) => { void updateDefaults({ allowWrite: checked }) }}
            />
          </div>
        </div>

        {disabled && (
          <p className="text-xs text-amber-500">仅 smart 模式生效</p>
        )}
      </PopoverContent>
    </Popover>
  )
}
