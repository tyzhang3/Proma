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
    details: FileChangeDetail[]
}

interface FileChangeDetail {
    toolName: 'Edit' | 'Write'
    preview: string
    truncated: boolean
}

interface FileChangeSummaryProps {
    activities: ToolActivity[]
    className?: string
}

export const PREVIEW_LIMITS = {
    maxLines: 24,
    maxChars: 1600,
} as const

function getInputPath(input: Record<string, unknown>): string | null {
    const rawPath = input.file_path ?? input.filePath ?? input.path
    return typeof rawPath === 'string' && rawPath.length > 0 ? rawPath : null
}

function makePreview(text: string, prefix: string): { preview: string; truncated: boolean } {
    const allLines = text.split('\n')
    const limitedLines = allLines.slice(0, PREVIEW_LIMITS.maxLines)
    const byLine = limitedLines.map((line) => `${prefix}${line}`).join('\n')
    let preview = byLine
    let truncated = allLines.length > PREVIEW_LIMITS.maxLines

    if (preview.length > PREVIEW_LIMITS.maxChars) {
        preview = preview.slice(0, PREVIEW_LIMITS.maxChars) + '…'
        truncated = true
    }

    return { preview, truncated }
}

function buildDetail(toolName: 'Edit' | 'Write', input: Record<string, unknown>): FileChangeDetail | null {
    if (toolName === 'Write') {
        const content = typeof input.content === 'string' ? input.content : ''
        if (!content) return null
        const { preview, truncated } = makePreview(content, '+ ')
        return { toolName, preview, truncated }
    }

    const oldString = typeof input.old_string === 'string' ? input.old_string : ''
    const newString = typeof input.new_string === 'string' ? input.new_string : ''
    if (!oldString && !newString) return null

    const oldPreview = makePreview(oldString, '- ')
    const newPreview = makePreview(newString, '+ ')
    return {
        toolName,
        preview: `${oldPreview.preview}\n${newPreview.preview}`,
        truncated: oldPreview.truncated || newPreview.truncated,
    }
}

export function buildFileChanges(activities: ToolActivity[]): FileChange[] {
    const map = new Map<string, FileChange>()

    for (const a of activities) {
        if (a.toolName !== 'Edit' && a.toolName !== 'Write') continue
        const path = getInputPath(a.input)
        if (!path) continue

        const filename = path.split('/').pop() ?? path
        const existing = map.get(path)
        const stats = computeDiffStats(a.toolName, a.input)
        const additions = stats?.additions ?? 0
        const deletions = stats?.deletions ?? 0
        const detail = buildDetail(a.toolName, a.input)

        if (existing) {
            map.set(path, {
                ...existing,
                additions: existing.additions + additions,
                deletions: existing.deletions + deletions,
                details: detail ? [...existing.details, detail] : existing.details,
            })
            continue
        }

        map.set(path, {
            path,
            filename,
            additions,
            deletions,
            type: a.toolName === 'Write' ? 'create' : 'modify',
            details: detail ? [detail] : [],
        })
    }

    return Array.from(map.values())
}

export function FileChangeSummary({ activities, className }: FileChangeSummaryProps): React.ReactElement | null {
    const [expanded, setExpanded] = React.useState(false)
    const [selectedPath, setSelectedPath] = React.useState<string | null>(null)

    const changes = React.useMemo(() => buildFileChanges(activities), [activities])

    React.useEffect(() => {
        if (!expanded) setSelectedPath(null)
    }, [expanded])

    React.useEffect(() => {
        if (selectedPath && !changes.some((change) => change.path === selectedPath)) {
            setSelectedPath(null)
        }
    }, [changes, selectedPath])

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
                        <div key={change.path} className="flex flex-col gap-1.5">
                            <button
                                type="button"
                                onClick={() => setSelectedPath(selectedPath === change.path ? null : change.path)}
                                className="flex items-center justify-between text-[11px] w-full hover:bg-muted/30 rounded px-1 py-0.5 transition-colors"
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    {change.type === 'create' ? <Plus className="size-3 text-green-500" /> : <Pencil className="size-3 text-primary/60" />}
                                    <span className="truncate text-foreground/60" title={change.path}>{change.filename}</span>
                                    {selectedPath === change.path ? <ChevronDown className="size-2.5 opacity-40" /> : <ChevronRight className="size-2.5 opacity-40" />}
                                </div>
                                <div className="flex items-center gap-1.5 tabular-nums font-mono opacity-80">
                                    {change.deletions > 0 && <span className="text-destructive">-{change.deletions}</span>}
                                    {change.additions > 0 && <span className="text-green-600 dark:text-green-400">+{change.additions}</span>}
                                </div>
                            </button>

                            {selectedPath === change.path && (
                                <div className="pl-5 pr-1 py-1 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                                    {change.details.map((detail, idx) => (
                                        <div key={idx} className="space-y-1">
                                            <div className="text-[10px] text-muted-foreground/60 font-mono flex items-center gap-1.5">
                                                <span className="px-1 rounded bg-muted/50">{detail.toolName}</span>
                                            </div>
                                            <div className="rounded border border-border/30 bg-background/50 overflow-hidden">
                                                <pre className="text-[10px] p-2 overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed">
                                                    {detail.preview.split('\n').map((line, lineIdx, lines) => (
                                                        <React.Fragment key={lineIdx}>
                                                            <span
                                                                className={
                                                                    line.startsWith('+ ')
                                                                        ? 'text-green-600 dark:text-green-400'
                                                                        : line.startsWith('- ')
                                                                            ? 'text-destructive/80'
                                                                            : 'text-foreground/70'
                                                                }
                                                            >
                                                                {line}
                                                            </span>
                                                            {lineIdx < lines.length - 1 ? '\n' : null}
                                                        </React.Fragment>
                                                    ))}
                                                </pre>
                                                {detail.truncated && (
                                                    <div className="px-2 pb-2 text-[10px] text-muted-foreground/60">
                                                        已截断，仅展示前 {PREVIEW_LIMITS.maxLines} 行 / {PREVIEW_LIMITS.maxChars} 字符
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
