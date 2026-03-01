import { describe, expect, test } from 'bun:test'
import { classifyChatError } from './chat-error-classifier'

describe('classifyChatError', () => {
    test('429 状态码 → rate_limit + retriable', () => {
        const result = classifyChatError(new Error('Request failed with status 429'))
        expect(result.errorCode).toBe('rate_limit')
        expect(result.retriable).toBe(true)
    })

    test('rate limit 关键词 → rate_limit + retriable', () => {
        const result = classifyChatError(new Error('Rate limit exceeded'))
        expect(result.errorCode).toBe('rate_limit')
        expect(result.retriable).toBe(true)
    })

    test('500 Internal Server Error → server_error + retriable', () => {
        const result = classifyChatError(new Error('HTTP error 500 Internal Server Error'))
        expect(result.errorCode).toBe('server_error')
        expect(result.retriable).toBe(true)
    })

    test('401 Unauthorized → provider_error + not retriable', () => {
        const result = classifyChatError(new Error('HTTP error 401 Unauthorized'))
        expect(result.errorCode).toBe('provider_error')
        expect(result.retriable).toBe(false)
    })

    test('fetch failed → network_error + retriable', () => {
        const result = classifyChatError(new Error('fetch failed'))
        expect(result.errorCode).toBe('network_error')
        expect(result.retriable).toBe(true)
    })

    test('ECONNRESET → network_error + retriable', () => {
        const result = classifyChatError(new Error('read ECONNRESET'))
        expect(result.errorCode).toBe('network_error')
        expect(result.retriable).toBe(true)
    })

    test('"timeout after 300ms" → network_error（而非误判为 HTTP 300）', () => {
        const result = classifyChatError(new Error('timeout after 300ms'))
        expect(result.errorCode).toBe('network_error')
        expect(result.retriable).toBe(true)
    })

    test('无法识别的错误 → unknown_error + not retriable', () => {
        const result = classifyChatError(new Error('Something went wrong'))
        expect(result.errorCode).toBe('unknown_error')
        expect(result.retriable).toBe(false)
    })

    test('非 Error 对象也能处理', () => {
        const result = classifyChatError('plain string error')
        expect(result.errorCode).toBe('unknown_error')
        expect(result.message).toBe('plain string error')
    })

    test('status code 502 with context word → server_error', () => {
        const result = classifyChatError(new Error('Upstream returned status code 502'))
        expect(result.errorCode).toBe('server_error')
        expect(result.retriable).toBe(true)
    })
})
