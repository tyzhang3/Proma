/**
 * Agent 系统提示词类型定义
 *
 * 管理 Agent 模式的系统提示词（system prompt）。
 */

/** Agent 系统提示词 */
export interface AgentSystemPrompt {
  /** 唯一标识 */
  id: string
  /** 提示词名称 */
  name: string
  /** 提示词内容 */
  content: string
  /** 是否为内置提示词（不可编辑/删除） */
  isBuiltin: boolean
  /** 创建时间 */
  createdAt: number
  /** 更新时间 */
  updatedAt: number
}

/** Agent 系统提示词配置（存储在 ~/.proma/agent-system-prompts.json） */
export interface AgentSystemPromptConfig {
  /** 提示词列表 */
  prompts: AgentSystemPrompt[]
  /** 默认提示词 ID */
  defaultPromptId?: string
}

/** 创建 Agent 提示词输入 */
export interface AgentSystemPromptCreateInput {
  name: string
  content: string
}

/** 更新 Agent 提示词输入 */
export interface AgentSystemPromptUpdateInput {
  name?: string
  content?: string
}

/** Agent 内置默认提示词 ID */
export const AGENT_BUILTIN_DEFAULT_ID = 'agent-builtin-default'

/** Proma Agent 内置默认提示词内容（空串表示不追加） */
export const AGENT_BUILTIN_DEFAULT_PROMPT_STRING = ''

/** Proma Agent 内置默认提示词 */
export const AGENT_BUILTIN_DEFAULT_PROMPT: AgentSystemPrompt = {
  id: AGENT_BUILTIN_DEFAULT_ID,
  name: 'Agent 内置提示词',
  content: AGENT_BUILTIN_DEFAULT_PROMPT_STRING,
  isBuiltin: true,
  createdAt: 0,
  updatedAt: 0,
}

/** Agent 系统提示词 IPC 通道常量 */
export const AGENT_SYSTEM_PROMPT_IPC_CHANNELS = {
  /** 获取完整配置 */
  GET_CONFIG: 'agent-system-prompt:get-config',
  /** 创建提示词 */
  CREATE: 'agent-system-prompt:create',
  /** 更新提示词 */
  UPDATE: 'agent-system-prompt:update',
  /** 删除提示词 */
  DELETE: 'agent-system-prompt:delete',
  /** 设置默认提示词 */
  SET_DEFAULT: 'agent-system-prompt:set-default',
} as const
