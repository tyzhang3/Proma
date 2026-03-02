/**
 * 通用文件与附件类型定义
 */

/** 文件附件 */
export interface FileAttachment {
    /** 附件唯一标识 */
    id: string
    /** 原始文件名 */
    filename: string
    /** MIME 类型 */
    mediaType: string
    /** 相对路径 */
    localPath: string
    /** 文件大小（字节） */
    size: number
}

/** 保存附件输入 */
export interface AttachmentSaveInput {
    /** 关联 ID (如 conversationId 或 sessionId) */
    conversationId: string
    /** 原始文件名 */
    filename: string
    /** MIME 类型 */
    mediaType: string
    /** base64 编码的文件数据 */
    data: string
}

/**
 * 消息角色
 */
export type MessageRole = 'user' | 'assistant' | 'system'

/**
 * 通用聊天消息 (保留用于适配器兼容)
 */
export interface ChatMessage {
    /** 消息唯一标识 */
    id: string
    /** 发送者角色 */
    role: MessageRole
    /** 消息内容 */
    content: string
    /** 创建时间戳 */
    createdAt: number
    /** 使用的模型 ID（assistant 消息） */
    model?: string
    /** 推理内容（如果模型支持） */
    reasoning?: string
    /** 是否被用户中止 */
    stopped?: boolean
    /** 文件附件列表 */
    attachments?: FileAttachment[]
}

/**
 * 通用对话 (保留用于适配器兼容)
 */
export interface Conversation {
    /** 对话唯一标识 */
    id: string
    /** 对话标题 */
    title: string
    /** 消息列表 */
    messages: ChatMessage[]
    /** 默认使用的模型 ID */
    modelId?: string
    /** 系统提示词 */
    systemMessage?: string
    /** 创建时间戳 */
    createdAt: number
    /** 更新时间戳 */
    updatedAt: number
}

/**
 * 模型选项（扁平化的渠道+模型组合）
 */
export interface ModelOption {
    /** 渠道 ID */
    channelId: string
    /** 渠道名称 */
    channelName: string
    /** 模型 ID */
    modelId: string
    /** 模型显示名称 */
    modelName: string
    /** AI 供应商类型 */
    provider: any
}

/**
 * 最近消息加载结果 (保留以防 Agent 模块复用列表结构)
 */
export interface RecentMessagesResult {
    /** 本次返回的消息列表 */
    messages: ChatMessage[]
    /** 总条数 */
    total: number
    /** 是否还有更多 */
    hasMore: boolean
}

/** 保存附件结果 */
export interface AttachmentSaveResult {
    /** 保存后的附件信息 */
    attachment: FileAttachment
}

/** 文件选择对话框结果 */
export interface FileDialogResult {
    /** 选择的文件列表 */
    files: Array<{
        filename: string
        mediaType: string
        data: string
        size: number
    }>
}
