/**
 * FileChangeSummary — Agent 变更文件汇总面板
 * 
 * 提取 ToolActivity 中的 Edit/Write 事件，显示受影响的文件列表和统计信息。
 */

import * as React from 'react'
import { FileText, Plus, Pencil, ChevronRight, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ToolActivity } from '@/atoms/agent-atoms'
import { computeDiffStats } from './ToolActivityItem'

interface FileChange {
    path: string
    filename: string
    additions: number
    deletions: number
    type: 'modify' | 'create'
}

interface FileChangeSummaryProps {
    activities: ToolActivity[]
    className?: string
}

export function FileChangeSummary({ activities, className }: FileChangeSummaryProps): React.ReactElement | null {
    const [expanded, setExpanded] = React.useState(false)

    const changes = React.useMemo(() => {
        const map = new Map<string, FileChange>()

        for (const a of activities) {
            if (a.toolName === 'Edit' || a.toolName === 'Write') {
                const path = (a.input.file_path ?? a.input.filePath ?? a.input.path) as string
                if (!path) continue

                const filename = path.split('/').pop() ?? path
                const existing = map.get(path)
                const stats = computeDiffStats(a.toolName, a.input)
                const adds = stats?.additions ?? 0
                const dels = stats?.deletions ?? 0

                if (existing) {
                    map.set(path, {
                        ...existing,
                        additions: existing.additions + adds,
                        deletions: existing.deletions + dels,
                    })
                } else {
                    map.set(path, {
                        path,
                        filename,
                        additions: adds,
                        deletions: dels,
                        type: a.toolName === 'Write' ? 'create' : 'modify'
                    })
                }
            }
        }

        return Array.from(map.values())
    }, [activities])

    if (changes.length === 0) return null

    const totalAdds = changes.reduce((acc, c) => acc + c.additions, 0)
    const totalDels = changes.reduce((acc, c) => acc + c.deletions, 0)

    return (
        <div className={cn("mt-2 rounded-lg border border-border/40 bg-muted/10 overflow-hidden", className)}>
            <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/20 transition-colors"
            >
                <div className="flex items-center gap-2 text-[12px] font-medium text-foreground/70">
                    <FileText className="size-3.5" />
                    <span>本次对话修改了 {changes.length} 个文件</span>
                    <div className="flex items-center gap-1.5 ml-1 opacity-60">
                        {totalAdds > 0 && <span className="text-green-600 dark:text-green-400">+{totalAdds}</span>}
                        {totalDels > 0 && <span className="text-destructive">-{totalDels}</span>}
                    </div>
                </div>
                {expanded ? <ChevronDown className="size-3.5 opacity-50" /> : <ChevronRight className="size-3.5 opacity-50" />}
            </button>

            {expanded && (
                <div className="px-3 py-2 border-t border-border/30 space-y-1.5 bg-background/30">
                    {changes.map((change) => (
                        <div key={change.path} className="flex items-center justify-between text-[11px]">
                            <div className="flex items-center gap-2 min-w-0">
                                {change.type === 'create' ? <Plus className="size-3 text-green-500" /> : <Pencil className="size-3 text-primary/60" />}
                                <span className="truncate text-foreground/60" title={change.path}>{change.filename}</span>
                            </div>
                            <div className="flex items-center gap-1.5 tabular-nums font-mono opacity-80">
                                {change.deletions > 0 && <span className="text-destructive">-{change.deletions}</span>}
                                {change.additions > 0 && <span className="text-green-600 dark:text-green-400">+{change.additions}</span>}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
