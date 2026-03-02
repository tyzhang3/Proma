/**
 * Agent 工作区管理器
 *
 * 负责 Agent 工作区的 CRUD 操作。
 * - 工作区索引：~/.proma/agent-workspaces.json（轻量元数据）
 * - 工作区目录：~/.proma/agent-workspaces/{slug}/（Agent 的 cwd）
 *
 * 照搬 agent-session-manager.ts 的 readIndex/writeIndex 模式。
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, cpSync, rmSync, mkdirSync, statSync, lstatSync, readlinkSync, accessSync, constants, symlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'
import {
  getConfigDir,
  getAgentWorkspacesIndexPath,
  getAgentWorkspacesDir,
  getAgentWorkspacePath,
  getWorkspaceMcpPath,
  getWorkspaceSkillsDir,
  getDefaultSkillsDir,
  getGlobalSkillsDir,
} from './config-paths'
import type {
  AgentWorkspace,
  AgentUpdateWorkspaceInput,
  AgentSkillStorageInfo,
  McpServerEntry,
  WorkspaceMcpConfig,
  SkillMeta,
  WorkspaceCapabilities,
  PromaPermissionMode,
  WorkspacePermissionDefaults,
} from '@proma/shared'

/**
 * 工作区索引文件格式
 */
interface AgentWorkspacesIndex {
  /** 配置版本号 */
  version: number
  /** 工作区元数据列表 */
  workspaces: AgentWorkspace[]
}

/** 当前索引版本 */
const INDEX_VERSION = 1

/**
 * 读取工作区索引文件
 */
function readIndex(): AgentWorkspacesIndex {
  const indexPath = getAgentWorkspacesIndexPath()

  if (!existsSync(indexPath)) {
    return { version: INDEX_VERSION, workspaces: [] }
  }

  try {
    const raw = readFileSync(indexPath, 'utf-8')
    return JSON.parse(raw) as AgentWorkspacesIndex
  } catch (error) {
    console.error('[Agent 工作区] 读取索引文件失败:', error)
    return { version: INDEX_VERSION, workspaces: [] }
  }
}

/**
 * 写入工作区索引文件
 */
function writeIndex(index: AgentWorkspacesIndex): void {
  const indexPath = getAgentWorkspacesIndexPath()

  try {
    writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8')
  } catch (error) {
    console.error('[Agent 工作区] 写入索引文件失败:', error)
    throw new Error('写入 Agent 工作区索引失败')
  }
}

/**
 * 将名称转换为 URL-safe 的 slug
 *
 * 英文：kebab-case，中文/特殊字符：fallback 为 workspace-{timestamp}
 */
function slugify(name: string, existingSlugs: Set<string>): string {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  // 中文或其他非 ASCII 名称 fallback
  if (!base) {
    base = `workspace-${Date.now()}`
  }

  // 重复时加数字后缀
  let slug = base
  let counter = 1
  while (existingSlugs.has(slug)) {
    slug = `${base}-${counter}`
    counter++
  }

  return slug
}

function normalizeWorkspace(workspace: AgentWorkspace): AgentWorkspace {
  return {
    ...workspace,
    cwdMode: workspace.cwdMode || 'workspace-root',
  }
}

function validateRootPath(rootPath: string): string {
  const normalized = resolve(rootPath)
  if (!isAbsolute(normalized)) {
    throw new Error('工作目录必须为绝对路径')
  }

  if (!existsSync(normalized)) {
    throw new Error('工作目录不存在，请重新选择')
  }

  const stat = statSync(normalized)
  if (!stat.isDirectory()) {
    throw new Error('工作目录必须是文件夹')
  }

  try {
    accessSync(normalized, constants.R_OK | constants.W_OK)
  } catch {
    throw new Error('工作目录无读写权限，请选择其他目录')
  }
  return normalized
}

/**
 * 获取所有工作区（按 updatedAt 降序）
 */
export function listAgentWorkspaces(): AgentWorkspace[] {
  const index = readIndex()
  return index.workspaces.map(normalizeWorkspace).sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * 按 ID 获取单个工作区
 */
export function getAgentWorkspace(id: string): AgentWorkspace | undefined {
  const index = readIndex()
  const workspace = index.workspaces.find((w) => w.id === id)
  return workspace ? normalizeWorkspace(workspace) : undefined
}

const GLOBAL_SKILLS_MIGRATION_MARKER = 'global-skills-v1.done'

function getGlobalSkillsMigrationMarkerPath(): string {
  const migrationDir = join(getConfigDir(), '.migrations')
  if (!existsSync(migrationDir)) {
    mkdirSync(migrationDir, { recursive: true })
  }
  return join(migrationDir, GLOBAL_SKILLS_MIGRATION_MARKER)
}

function parseUpdatedAtValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

function resolveSkillUpdatedAt(skillDirPath: string): number {
  const manifestPath = join(skillDirPath, 'manifest.json')
  if (existsSync(manifestPath)) {
    try {
      const raw = readFileSync(manifestPath, 'utf-8')
      const parsed = JSON.parse(raw) as { updatedAt?: unknown }
      const manifestUpdatedAt = parseUpdatedAtValue(parsed.updatedAt)
      if (manifestUpdatedAt !== null) {
        return manifestUpdatedAt
      }
    } catch {
      // ignore malformed manifest and continue fallback chain
    }
  }

  const skillMdPath = join(skillDirPath, 'SKILL.md')
  if (existsSync(skillMdPath)) {
    return statSync(skillMdPath).mtimeMs
  }

  return statSync(skillDirPath).mtimeMs
}

function listSkillDirectories(skillsDir: string): Array<{ slug: string; path: string; updatedAt: number }> {
  const skills: Array<{ slug: string; path: string; updatedAt: number }> = []
  if (!existsSync(skillsDir)) return skills

  const entries = readdirSync(skillsDir, { withFileTypes: true })
  for (const entry of entries) {
    try {
      const skillPath = join(skillsDir, entry.name)
      const isDir = entry.isDirectory() || (entry.isSymbolicLink() && statSync(skillPath).isDirectory())
      if (!isDir) continue
      skills.push({
        slug: entry.name,
        path: skillPath,
        updatedAt: resolveSkillUpdatedAt(skillPath),
      })
    } catch {
      // 单个目录异常不影响整体扫描
    }
  }

  return skills
}

/**
 * 将默认 Skills 模板复制到全局共享目录。
 *
 * 仅复制缺失的 skill，不覆盖用户已存在内容。
 */
function copyDefaultSkillsToGlobal(): void {
  const defaultDir = getDefaultSkillsDir()
  const globalSkillsDir = getGlobalSkillsDir()

  try {
    const entries = readdirSync(defaultDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const source = join(defaultDir, entry.name)
      const target = join(globalSkillsDir, entry.name)
      if (!existsSync(target)) {
        cpSync(source, target, { recursive: true })
      }
    }
  } catch {
    // 模板目录不存在或复制失败，跳过不影响主流程
  }
}

function upsertGlobalSkill(sourceSkillPath: string, skillSlug: string): void {
  const globalSkillsDir = getGlobalSkillsDir()
  const targetSkillPath = join(globalSkillsDir, skillSlug)

  if (!existsSync(targetSkillPath)) {
    cpSync(sourceSkillPath, targetSkillPath, { recursive: true })
    return
  }

  const sourceUpdatedAt = resolveSkillUpdatedAt(sourceSkillPath)
  const targetUpdatedAt = resolveSkillUpdatedAt(targetSkillPath)
  if (sourceUpdatedAt > targetUpdatedAt) {
    rmSync(targetSkillPath, { recursive: true, force: true })
    cpSync(sourceSkillPath, targetSkillPath, { recursive: true })
  }
}

/**
 * 确保工作区 skills 入口链接到全局共享目录。
 */
export function ensureWorkspaceSkillsLink(workspaceSlug: string): void {
  const workspacePath = getAgentWorkspacePath(workspaceSlug)
  const workspaceSkillsPath = join(workspacePath, 'skills')
  const globalSkillsDir = getGlobalSkillsDir()

  if (existsSync(workspaceSkillsPath)) {
    const currentStat = lstatSync(workspaceSkillsPath)
    if (currentStat.isSymbolicLink()) {
      const linkedTarget = readlinkSync(workspaceSkillsPath)
      const resolvedLinkedTarget = resolve(workspacePath, linkedTarget)
      if (resolvedLinkedTarget === resolve(globalSkillsDir)) {
        return
      }
    }
    if (currentStat.isDirectory()) {
      const localSkills = listSkillDirectories(workspaceSkillsPath)
      for (const skill of localSkills) {
        upsertGlobalSkill(skill.path, skill.slug)
      }
    }
    rmSync(workspaceSkillsPath, { recursive: true, force: true })
  }

  try {
    symlinkSync(globalSkillsDir, workspaceSkillsPath, 'dir')
  } catch (error) {
    console.warn(`[Agent 工作区] 创建 skills 共享链接失败: ${workspaceSlug}`, error)
    try {
      mkdirSync(workspaceSkillsPath, { recursive: true })
      cpSync(globalSkillsDir, workspaceSkillsPath, { recursive: true })
    } catch (fallbackError) {
      console.warn(`[Agent 工作区] skills 回退复制失败: ${workspaceSlug}`, fallbackError)
    }
  }
}

export function getSkillStorageInfo(): AgentSkillStorageInfo {
  return {
    mode: 'global-shared',
    globalSkillsPath: getGlobalSkillsDir(),
  }
}

/**
 * 一次性迁移：将历史工作区 skills 合并到全局目录并建立链接。
 */
export function migrateWorkspaceSkillsToGlobalIfNeeded(): void {
  const markerPath = getGlobalSkillsMigrationMarkerPath()
  if (existsSync(markerPath)) return

  try {
    const workspaceSlugs = new Set<string>()
    const index = readIndex()
    for (const workspace of index.workspaces) {
      workspaceSlugs.add(workspace.slug)
    }

    const workspacesRoot = getAgentWorkspacesDir()
    const workspaceDirEntries = readdirSync(workspacesRoot, { withFileTypes: true })
    for (const entry of workspaceDirEntries) {
      if (entry.isDirectory()) {
        workspaceSlugs.add(entry.name)
      }
    }

    let hasWorkspaceError = false
    for (const workspaceSlug of workspaceSlugs) {
      try {
        const workspaceSkillsPath = getWorkspaceSkillsDir(workspaceSlug)
        const skillDirs = listSkillDirectories(workspaceSkillsPath)
        for (const skill of skillDirs) {
          upsertGlobalSkill(skill.path, skill.slug)
        }
        ensureWorkspaceSkillsLink(workspaceSlug)
      } catch (error) {
        hasWorkspaceError = true
        console.warn(`[Agent 工作区] 迁移工作区 Skills 失败: ${workspaceSlug}`, error)
      }
    }

    copyDefaultSkillsToGlobal()
    if (!hasWorkspaceError) {
      writeFileSync(markerPath, String(Date.now()), 'utf-8')
      console.log('[Agent 工作区] 已完成 Skills 全局共享迁移')
    } else {
      console.warn('[Agent 工作区] Skills 迁移部分失败，下次启动将重试')
    }
  } catch (error) {
    console.warn('[Agent 工作区] Skills 全局共享迁移失败，已跳过:', error)
  }
}

/**
 * 创建新工作区
 */
export function createAgentWorkspace(name: string): AgentWorkspace {
  const index = readIndex()
  const existingSlugs = new Set(index.workspaces.map((w) => w.slug))
  const slug = slugify(name, existingSlugs)
  const now = Date.now()

  const workspace: AgentWorkspace = {
    id: randomUUID(),
    name,
    slug,
    cwdMode: 'workspace-root',
    createdAt: now,
    updatedAt: now,
  }

  // 创建工作区目录
  getAgentWorkspacePath(slug)

  // 创建 SDK plugin manifest（SDK 需要此文件发现 skills）
  ensurePluginManifest(slug, name)

  // 初始化全局 Skills 并建立工作区共享入口
  copyDefaultSkillsToGlobal()
  ensureWorkspaceSkillsLink(slug)

  index.workspaces.push(workspace)
  writeIndex(index)

  console.log(`[Agent 工作区] 已创建工作区: ${name} (slug: ${slug})`)
  return workspace
}

/**
 * 更新工作区（仅更新名称，不改 slug/目录）
 */
export function updateAgentWorkspace(
  id: string,
  updates: AgentUpdateWorkspaceInput,
): AgentWorkspace {
  const index = readIndex()
  const idx = index.workspaces.findIndex((w) => w.id === id)

  if (idx === -1) {
    throw new Error(`Agent 工作区不存在: ${id}`)
  }

  const existing = index.workspaces[idx]!
  const nextName = updates.name?.trim()
  const nextRootPath = updates.rootPath === undefined
    ? existing.rootPath
    : updates.rootPath === ''
      ? undefined
      : validateRootPath(updates.rootPath)

  const updated: AgentWorkspace = normalizeWorkspace({
    ...existing,
    ...(nextName ? { name: nextName } : {}),
    rootPath: nextRootPath,
    ...(updates.cwdMode ? { cwdMode: updates.cwdMode } : {}),
    updatedAt: Date.now(),
  })

  index.workspaces[idx] = updated
  writeIndex(index)

  console.log(`[Agent 工作区] 已更新工作区: ${updated.name} (${updated.id})`)
  return updated
}

/**
 * 删除工作区（仅删索引条目，保留目录避免误删用户文件）
 */
export function deleteAgentWorkspace(id: string): void {
  const index = readIndex()
  const idx = index.workspaces.findIndex((w) => w.id === id)

  if (idx === -1) {
    throw new Error(`Agent 工作区不存在: ${id}`)
  }

  const removed = index.workspaces.splice(idx, 1)[0]!
  writeIndex(index)

  console.log(`[Agent 工作区] 已删除工作区索引: ${removed.name} (slug: ${removed.slug}，目录已保留)`)
}

/**
 * 确保默认工作区存在
 *
 * 首次启动时自动创建名为"默认工作区"的工作区（slug: default）。
 * 返回默认工作区的 ID。
 */
export function ensureDefaultWorkspace(): AgentWorkspace {
  const index = readIndex()
  let defaultWs = index.workspaces.find((w) => w.slug === 'default')

  if (!defaultWs) {
    const now = Date.now()
    defaultWs = {
      id: randomUUID(),
      name: '默认工作区',
      slug: 'default',
      cwdMode: 'workspace-root',
      createdAt: now,
      updatedAt: now,
    }

    // 创建工作区目录
    getAgentWorkspacePath('default')

    // 创建 SDK plugin manifest
    ensurePluginManifest('default', '默认工作区')

    // 初始化全局 Skills 并建立工作区共享入口
    copyDefaultSkillsToGlobal()
    ensureWorkspaceSkillsLink('default')

    index.workspaces.push(defaultWs)
    writeIndex(index)

    console.log('[Agent 工作区] 已创建默认工作区')
  } else {
    // 迁移兼容：确保已有默认工作区包含 plugin manifest 和共享 skills 入口
    ensurePluginManifest(defaultWs.slug, defaultWs.name)
    copyDefaultSkillsToGlobal()
    ensureWorkspaceSkillsLink(defaultWs.slug)
  }

  return normalizeWorkspace(defaultWs)
}

// ===== Plugin Manifest（SDK 插件发现） =====

/**
 * 确保工作区包含 .claude-plugin/plugin.json 清单
 *
 * SDK 需要此文件才能将工作区识别为合法插件，
 * 进而发现 skills/ 目录下的 Skill。
 */
export function ensurePluginManifest(workspaceSlug: string, workspaceName: string): void {
  const wsPath = getAgentWorkspacePath(workspaceSlug)
  const pluginDir = join(wsPath, '.claude-plugin')
  const manifestPath = join(pluginDir, 'plugin.json')

  if (existsSync(manifestPath)) return

  if (!existsSync(pluginDir)) {
    mkdirSync(pluginDir, { recursive: true })
  }

  const manifest = {
    name: `proma-workspace-${workspaceSlug}`,
    version: '1.0.0',
  }

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
  console.log(`[Agent 工作区] 已创建 plugin manifest: ${workspaceSlug}`)
}

// ===== MCP 配置管理 =====

/**
 * 读取工作区 MCP 配置
 */
export function getWorkspaceMcpConfig(workspaceSlug: string): WorkspaceMcpConfig {
  const mcpPath = getWorkspaceMcpPath(workspaceSlug)

  if (!existsSync(mcpPath)) {
    return { servers: {} }
  }

  try {
    const raw = readFileSync(mcpPath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<WorkspaceMcpConfig>
    return { servers: parsed.servers ?? {} }
  } catch (error) {
    console.error('[Agent 工作区] 读取 MCP 配置失败:', error)
    return { servers: {} }
  }
}

/**
 * 保存工作区 MCP 配置
 */
export function saveWorkspaceMcpConfig(workspaceSlug: string, config: WorkspaceMcpConfig): void {
  const mcpPath = getWorkspaceMcpPath(workspaceSlug)

  try {
    writeFileSync(mcpPath, JSON.stringify(config, null, 2), 'utf-8')
    console.log(`[Agent 工作区] 已保存 MCP 配置: ${workspaceSlug}`)
  } catch (error) {
    console.error('[Agent 工作区] 保存 MCP 配置失败:', error)
    throw new Error('保存 MCP 配置失败')
  }
}

// ===== Skill 目录扫描 =====

/**
 * 扫描全局共享 Skills 目录
 *
 * 遍历 ~/.proma/skills/{slug}/SKILL.md，解析 YAML frontmatter 提取元数据。
 */
export function getWorkspaceSkills(workspaceSlug: string): SkillMeta[] {
  // workspaceSlug 参数保留兼容；Skills 统一从全局共享目录读取
  const skillsDir = getGlobalSkillsDir()
  const skills: SkillMeta[] = []

  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true })

    for (const entry of entries) {
      const isDir = entry.isDirectory() || (entry.isSymbolicLink() && statSync(join(skillsDir, entry.name)).isDirectory())
      if (!isDir) continue

      const skillMdPath = join(skillsDir, entry.name, 'SKILL.md')
      if (!existsSync(skillMdPath)) continue

      try {
        const content = readFileSync(skillMdPath, 'utf-8')
        const meta = parseSkillFrontmatter(content, entry.name)
        skills.push(meta)
      } catch {
        console.warn(`[Agent 工作区] 解析 Skill 失败: ${entry.name}`)
      }
    }
  } catch {
    // skills 目录可能不存在
  }

  return skills
}

/**
 * 解析 SKILL.md 的 YAML frontmatter
 */
function parseSkillFrontmatter(content: string, slug: string): SkillMeta {
  const meta: SkillMeta = { slug, name: slug }

  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!fmMatch) return meta

  const yaml = fmMatch[1]
  if (!yaml) return meta

  for (const line of yaml.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue

    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '')

    if (key === 'name' && value) meta.name = value
    if (key === 'description' && value) meta.description = value
    if (key === 'icon' && value) meta.icon = value
  }

  return meta
}

// ===== 工作区能力摘要 =====

/**
 * 获取工作区能力摘要（MCP + Skill 计数）
 */
export function getWorkspaceCapabilities(workspaceSlug: string): WorkspaceCapabilities {
  const mcpConfig = getWorkspaceMcpConfig(workspaceSlug)
  const skills = getWorkspaceSkills(workspaceSlug)

  const mcpServers = Object.entries(mcpConfig.servers ?? {}).map(([name, entry]) => ({
    name,
    enabled: entry.enabled,
    type: entry.type,
  }))

  return { mcpServers, skills }
}

/**
 * 删除工作区 Skill
 *
 * 删除全局 skills/{slug}/ 整个目录（workspaceSlug 仅用于兼容日志）。
 */
export function deleteWorkspaceSkill(workspaceSlug: string, skillSlug: string): void {
  // workspaceSlug 参数保留兼容；Skills 统一从全局共享目录删除
  const skillsDir = getGlobalSkillsDir()
  const skillPath = join(skillsDir, skillSlug)

  if (!existsSync(skillPath)) {
    throw new Error(`Skill 不存在: ${skillSlug}`)
  }

  rmSync(skillPath, { recursive: true, force: true })
  console.log(`[Agent 工作区] 已删除 Skill: ${workspaceSlug}/${skillSlug}（全局共享）`)
}

// ===== 权限模式管理 =====

/** 工作区配置文件格式 */
interface WorkspaceConfig {
  permissionMode?: PromaPermissionMode
  permissionDefaults?: Partial<WorkspacePermissionDefaults>
}

const DEFAULT_WORKSPACE_PERMISSION_DEFAULTS: WorkspacePermissionDefaults = {
  allowWrite: false,
  allowExecute: false,
}

/**
 * 获取工作区配置文件路径
 */
function getWorkspaceConfigPath(workspaceSlug: string): string {
  return join(getAgentWorkspacePath(workspaceSlug), 'config.json')
}

/**
 * 读取工作区配置
 */
function readWorkspaceConfig(workspaceSlug: string): WorkspaceConfig {
  const configPath = getWorkspaceConfigPath(workspaceSlug)

  if (!existsSync(configPath)) {
    return {}
  }

  try {
    const raw = readFileSync(configPath, 'utf-8')
    return JSON.parse(raw) as WorkspaceConfig
  } catch {
    return {}
  }
}

/**
 * 写入工作区配置
 */
function writeWorkspaceConfig(workspaceSlug: string, config: WorkspaceConfig): void {
  const configPath = getWorkspaceConfigPath(workspaceSlug)
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}

/**
 * 获取工作区权限模式
 *
 * 默认返回 'smart'（智能模式）。
 */
export function getWorkspacePermissionMode(workspaceSlug: string): PromaPermissionMode {
  const config = readWorkspaceConfig(workspaceSlug)
  return config.permissionMode ?? 'smart'
}

/**
 * 获取工作区默认放行配置
 *
 * 默认返回 { allowWrite: false, allowExecute: false }。
 */
export function getWorkspacePermissionDefaults(workspaceSlug: string): WorkspacePermissionDefaults {
  const config = readWorkspaceConfig(workspaceSlug)
  return {
    allowWrite: config.permissionDefaults?.allowWrite ?? DEFAULT_WORKSPACE_PERMISSION_DEFAULTS.allowWrite,
    allowExecute: config.permissionDefaults?.allowExecute ?? DEFAULT_WORKSPACE_PERMISSION_DEFAULTS.allowExecute,
  }
}

/**
 * 设置工作区权限模式
 */
export function setWorkspacePermissionMode(workspaceSlug: string, mode: PromaPermissionMode): void {
  const config = readWorkspaceConfig(workspaceSlug)
  const updated: WorkspaceConfig = { ...config, permissionMode: mode }
  writeWorkspaceConfig(workspaceSlug, updated)
  console.log(`[Agent 工作区] 权限模式已更新: ${workspaceSlug} → ${mode}`)
}

/**
 * 设置工作区默认放行配置
 */
export function setWorkspacePermissionDefaults(workspaceSlug: string, defaults: WorkspacePermissionDefaults): void {
  const config = readWorkspaceConfig(workspaceSlug)
  const updated: WorkspaceConfig = {
    ...config,
    permissionDefaults: {
      ...config.permissionDefaults,
      allowWrite: defaults.allowWrite,
      allowExecute: defaults.allowExecute,
    },
  }
  writeWorkspaceConfig(workspaceSlug, updated)
  console.log(`[Agent 工作区] 默认放行配置已更新: ${workspaceSlug} → write=${defaults.allowWrite}, execute=${defaults.allowExecute}`)
}
