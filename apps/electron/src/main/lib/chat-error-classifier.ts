/**
 * Chat 错误分类（纯函数，无 Electron 依赖，可独立测试）
 */

import type { ChatStreamErrorCode } from '@proma/shared'

export interface ClassifiedChatError {
    errorCode: ChatStreamErrorCode
    retriable: boolean
    message: string
}

export function classifyChatError(error: unknown): ClassifiedChatError {
    const message = error instanceof Error ? error.message : String(error)
    const lower = message.toLowerCase()

    // 1. Rate limit（最高优先级）
    if (lower.includes('429') || lower.includes('rate limit')) {
        return {
            errorCode: 'rate_limit',
            retriable: true,
            message,
        }
    }

    // 2. 网络 / 超时关键词（优先于 HTTP 状态码正则，避免 "timeout after 300ms" 被误判为 HTTP 300）
    if (
        lower.includes('fetch failed')
        || lower.includes('network')
        || lower.includes('econnreset')
        || lower.includes('etimedout')
        || lower.includes('timeout')
        || lower.includes('socket')
        || lower.includes('enotfound')
        || lower.includes('eai_again')
    ) {
        return {
            errorCode: 'network_error',
            retriable: true,
            message,
        }
    }

    // 3. HTTP 状态码（收紧正则：要求前方出现 status / http / code / error 等上下文词）
    const statusMatch = message.match(/\b(?:status|http|code|error)\D{0,10}([1-5]\d{2})\b/i)
    if (statusMatch) {
        const statusCode = Number(statusMatch[1])
        if (statusCode >= 500 && statusCode <= 599) {
            return {
                errorCode: 'server_error',
                retriable: true,
                message,
            }
        }
        if (statusCode >= 400 && statusCode <= 499) {
            return {
                errorCode: 'provider_error',
                retriable: false,
                message,
            }
        }
    }

    return {
        errorCode: 'unknown_error',
        retriable: false,
        message,
    }
}
