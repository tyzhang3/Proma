/**
 * Agent Atoms Unit Tests
 */
import { describe, it, expect } from 'bun:test'
import { applyAgentEvent, type AgentStreamState } from './agent-atoms'
import type { AgentEvent } from '@proma/shared'

describe('applyAgentEvent', () => {
    const initialState: AgentStreamState = {
        running: true,
        content: '',
        toolActivities: [],
        intermediateTexts: [],
    }

    it('should append text on text_delta', () => {
        const event: AgentEvent = { type: 'text_delta', text: 'Hello ' }
        const state = applyAgentEvent(initialState, event)
        expect(state.content).toBe('Hello ')

        const event2: AgentEvent = { type: 'text_delta', text: 'World' }
        const state2 = applyAgentEvent(state, event2)
        expect(state2.content).toBe('Hello World')
    })

    it('should handle intermediate text_complete correctly', () => {
        const stateWithContent: AgentStreamState = {
            ...initialState,
            content: 'Thinking...',
        }
        const event: AgentEvent = {
            type: 'text_complete',
            text: 'Thinking...',
            isIntermediate: true
        }

        const state = applyAgentEvent(stateWithContent, event)
        expect(state.content).toBe('')
        expect(state.intermediateTexts).toEqual(['Thinking...'])
    })

    it('should handle regular text_complete by replacing content', () => {
        const stateWithContent: AgentStreamState = {
            ...initialState,
            content: 'Incremental content',
        }
        const event: AgentEvent = {
            type: 'text_complete',
            text: 'Final complete text',
            isIntermediate: false
        }

        const state = applyAgentEvent(stateWithContent, event)
        expect(state.content).toBe('Final complete text')
    })

    it('should handle multiple intermediate thoughts', () => {
        let state: AgentStreamState = { ...initialState, intermediateTexts: ['First'] }
        const event: AgentEvent = {
            type: 'text_complete',
            text: 'Second',
            isIntermediate: true
        }

        state = applyAgentEvent(state, event)
        expect(state.intermediateTexts).toEqual(['First', 'Second'])
    })

    it('should handle system_status by setting statusMessage', () => {
        const event: AgentEvent = { type: 'system_status', message: 'Initializing MCP...' }
        const state = applyAgentEvent(initialState, event)
        expect(state.statusMessage).toBe('Initializing MCP...')
    })

    it('should clear statusMessage on text_delta', () => {
        const stateWithStatus: AgentStreamState = {
            ...initialState,
            statusMessage: 'Loading...',
        }
        const event: AgentEvent = { type: 'text_delta', text: 'Some result' }
        const state = applyAgentEvent(stateWithStatus, event)
        expect(state.statusMessage).toBeUndefined()
        expect(state.content).toBe('Some result')
    })

    it('should clear statusMessage on tool_start', () => {
        const stateWithStatus: AgentStreamState = {
            ...initialState,
            statusMessage: 'Loading...',
        }
        const event: AgentEvent = {
            type: 'tool_start',
            toolName: 'Read',
            toolUseId: 'u1',
            input: { path: 'test.txt' }
        }
        const state = applyAgentEvent(stateWithStatus, event)
        expect(state.statusMessage).toBeUndefined()
        expect(state.toolActivities.length).toBe(1)
    })
})
