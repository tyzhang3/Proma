import { describe, it, expect } from 'bun:test'
import type { ToolActivity } from '@/atoms/agent-atoms'
import { buildFileChanges, PREVIEW_LIMITS } from './FileChangeSummary'

function makeActivity(partial: Partial<ToolActivity>): ToolActivity {
    return {
        toolUseId: partial.toolUseId ?? 'tool',
        toolName: partial.toolName ?? 'Edit',
        input: partial.input ?? {},
        done: partial.done ?? true,
        isError: partial.isError ?? false,
        ...partial,
    } as ToolActivity
}

describe('buildFileChanges', () => {
    it('按路径聚合并累计统计', () => {
        const activities: ToolActivity[] = [
            makeActivity({
                toolUseId: '1',
                toolName: 'Edit',
                input: {
                    path: 'src/a.ts',
                    old_string: 'a',
                    new_string: 'a\nb',
                },
            }),
            makeActivity({
                toolUseId: '2',
                toolName: 'Edit',
                input: {
                    path: 'src/a.ts',
                    old_string: 'a\nb',
                    new_string: 'a',
                },
            }),
            makeActivity({
                toolUseId: '3',
                toolName: 'Write',
                input: {
                    path: 'src/b.ts',
                    content: 'export const b = 1',
                },
            }),
        ]

        const changes = buildFileChanges(activities)
        expect(changes).toHaveLength(2)

        const first = changes.find((change) => change.path === 'src/a.ts')
        expect(first).toBeDefined()
        expect(first?.details).toHaveLength(2)
        expect(first?.additions).toBe(2)
        expect(first?.deletions).toBe(2)

        const second = changes.find((change) => change.path === 'src/b.ts')
        expect(second?.type).toBe('create')
        expect(second?.details[0]?.toolName).toBe('Write')
    })

    it('Edit 预览使用 +/- 前缀', () => {
        const changes = buildFileChanges([
            makeActivity({
                toolName: 'Edit',
                input: {
                    path: 'src/c.ts',
                    old_string: 'oldLine',
                    new_string: 'newLine',
                },
            }),
        ])

        const detail = changes[0]?.details[0]
        expect(detail?.preview).toContain('- oldLine')
        expect(detail?.preview).toContain('+ newLine')
    })

    it('长内容会截断并标记 truncated', () => {
        const longContent = Array.from({ length: PREVIEW_LIMITS.maxLines + 10 }, (_, i) => `line-${i}`).join('\n')
        const changes = buildFileChanges([
            makeActivity({
                toolName: 'Write',
                input: {
                    path: 'src/long.ts',
                    content: longContent,
                },
            }),
        ])

        const detail = changes[0]?.details[0]
        expect(detail?.truncated).toBe(true)
        expect(detail?.preview).toContain('+ line-0')
        expect(detail?.preview).not.toContain(`line-${PREVIEW_LIMITS.maxLines + 9}`)
    })

    it('忽略缺少 path 的活动', () => {
        const changes = buildFileChanges([
            makeActivity({
                toolName: 'Edit',
                input: {
                    old_string: 'a',
                    new_string: 'b',
                },
            }),
        ])

        expect(changes).toHaveLength(0)
    })
})
