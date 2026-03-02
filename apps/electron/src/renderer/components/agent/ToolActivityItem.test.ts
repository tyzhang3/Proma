/**
 * ToolActivityItem Unit Tests
 */
import { describe, it, expect } from 'bun:test'
import { computeDiffStats, getInputSummary } from './ToolActivityItem'

describe('computeDiffStats', () => {
    it('should handle Edit tool with additions and deletions', () => {
        const input = {
            old_string: 'line1\nline2',
            new_string: 'line1\nlineA\nlineB',
        }
        const stats = computeDiffStats('Edit', input)
        // old: 2 lines, new: 3 lines
        // additions: 3 - 2 + 1 = 2
        // deletions: 2 - 3 + 1 = 0
        expect(stats).toEqual({ additions: 2, deletions: 0 })
    })

    it('should handle Write tool with additions', () => {
        const input = {
            content: 'line1\nline2\nline3',
        }
        const stats = computeDiffStats('Write', input)
        expect(stats).toEqual({ additions: 3, deletions: 0 })
    })

    it('should return null for non-modification tools', () => {
        expect(computeDiffStats('Bash', { command: 'ls' })).toBeNull()
    })
})

describe('getInputSummary', () => {
    it('should summarize Bash commands', () => {
        expect(getInputSummary('Bash', { command: 'npm install some-package' })).toBe('npm install some-package')
        expect(getInputSummary('Bash', { command: 'a'.repeat(100) })).toContain('…')
    })

    it('should handle result fallback for whitelisted tools', () => {
        // Read tool is in whitelist
        const result = 'First line of file\nSecond line'
        expect(getInputSummary('Read', { path: 'file.txt' }, result)).toBe('First line of file')
    })

    it('should NOT handle result fallback for non-whitelisted tools', () => {
        // Skill tool is NOT in the result summary whitelist (it has its own summary logic)
        const result = 'Internal Skill Result data'
        // It should skip the result fallback
        expect(getInputSummary('Skill', { skill: 'MySkill' }, result)).toBe('MySkill')
    })
})
