/**
 * Agent 系统提示词管理服务
 *
 * 管理 Agent 模式的系统提示词 CRUD。
 * 存储在 ~/.proma/agent-system-prompts.json
 */

import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { getAgentSystemPromptsPath } from './config-paths'
import {
  AGENT_BUILTIN_DEFAULT_ID,
  AGENT_BUILTIN_DEFAULT_PROMPT,
} from '@proma/shared'
import type {
  AgentSystemPrompt,
  AgentSystemPromptConfig,
  AgentSystemPromptCreateInput,
  AgentSystemPromptUpdateInput,
} from '@proma/shared'

/** 默认配置 */
function getDefaultConfig(): AgentSystemPromptConfig {
  return {
    prompts: [{ ...AGENT_BUILTIN_DEFAULT_PROMPT }],
    defaultPromptId: AGENT_BUILTIN_DEFAULT_ID,
  }
}

/** 读取配置文件 */
function readConfig(): AgentSystemPromptConfig {
  const filePath = getAgentSystemPromptsPath()

  if (!existsSync(filePath)) {
    return getDefaultConfig()
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as AgentSystemPromptConfig

    const prompts = Array.isArray(data.prompts) ? data.prompts : []
    const builtinIndex = prompts.findIndex((p) => p.id === AGENT_BUILTIN_DEFAULT_ID)
    if (builtinIndex === -1) {
      prompts.unshift({ ...AGENT_BUILTIN_DEFAULT_PROMPT })
    } else {
      prompts[builtinIndex] = { ...AGENT_BUILTIN_DEFAULT_PROMPT }
    }

    const defaultPromptId = data.defaultPromptId && prompts.some((p) => p.id === data.defaultPromptId)
      ? data.defaultPromptId
      : AGENT_BUILTIN_DEFAULT_ID

    return { prompts, defaultPromptId }
  } catch (error) {
    console.error('[Agent 系统提示词] 读取配置失败:', error)
    return getDefaultConfig()
  }
}

/** 写入配置文件 */
function writeConfig(config: AgentSystemPromptConfig): void {
  const filePath = getAgentSystemPromptsPath()

  try {
    writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8')
  } catch (error) {
    console.error('[Agent 系统提示词] 写入配置失败:', error)
    throw new Error('写入 Agent 系统提示词配置失败')
  }
}

/**
 * 获取 Agent 系统提示词配置
 */
export function getAgentSystemPromptConfig(): AgentSystemPromptConfig {
  return readConfig()
}

/**
 * 创建 Agent 自定义提示词
 */
export function createAgentSystemPrompt(input: AgentSystemPromptCreateInput): AgentSystemPrompt {
  const config = readConfig()
  const now = Date.now()

  const prompt: AgentSystemPrompt = {
    id: randomUUID(),
    name: input.name,
    content: input.content,
    isBuiltin: false,
    createdAt: now,
    updatedAt: now,
  }

  config.prompts.push(prompt)
  writeConfig(config)
  console.log(`[Agent 系统提示词] 已创建: ${prompt.name} (${prompt.id})`)
  return prompt
}

/**
 * 更新 Agent 提示词
 *
 * 内置提示词不可编辑。
 */
export function updateAgentSystemPrompt(id: string, input: AgentSystemPromptUpdateInput): AgentSystemPrompt {
  const config = readConfig()
  const index = config.prompts.findIndex((p) => p.id === id)
  if (index === -1) {
    throw new Error(`Agent 提示词不存在: ${id}`)
  }

  const prompt = config.prompts[index]!
  if (prompt.isBuiltin) {
    throw new Error('内置提示词不可编辑')
  }

  if (input.name !== undefined) prompt.name = input.name
  if (input.content !== undefined) prompt.content = input.content
  prompt.updatedAt = Date.now()

  writeConfig(config)
  console.log(`[Agent 系统提示词] 已更新: ${prompt.name} (${prompt.id})`)
  return prompt
}

/**
 * 删除 Agent 提示词
 *
 * 内置提示词不可删除。
 * 如果被删除的是当前默认提示词，重置为内置默认。
 */
export function deleteAgentSystemPrompt(id: string): void {
  const config = readConfig()
  const prompt = config.prompts.find((p) => p.id === id)
  if (!prompt) {
    throw new Error(`Agent 提示词不存在: ${id}`)
  }
  if (prompt.isBuiltin) {
    throw new Error('内置提示词不可删除')
  }

  config.prompts = config.prompts.filter((p) => p.id !== id)
  if (config.defaultPromptId === id) {
    config.defaultPromptId = AGENT_BUILTIN_DEFAULT_ID
  }

  writeConfig(config)
  console.log(`[Agent 系统提示词] 已删除: ${prompt.name} (${id})`)
}

/**
 * 设置 Agent 默认提示词
 *
 * 传入 null 清除自定义默认（回退到内置默认）。
 */
export function setDefaultAgentPrompt(id: string | null): void {
  const config = readConfig()

  if (id !== null) {
    const exists = config.prompts.some((p) => p.id === id)
    if (!exists) {
      throw new Error(`Agent 提示词不存在: ${id}`)
    }
  }

  config.defaultPromptId = id ?? AGENT_BUILTIN_DEFAULT_ID
  writeConfig(config)
  console.log(`[Agent 系统提示词] 默认提示词已设置: ${config.defaultPromptId}`)
}

/**
 * 获取默认 Agent 提示词内容
 */
export function getDefaultAgentSystemPromptContent(): string {
  const config = readConfig()
  const defaultId = config.defaultPromptId ?? AGENT_BUILTIN_DEFAULT_ID
  const prompt = config.prompts.find((p) => p.id === defaultId)
  return prompt?.content ?? ''
}
