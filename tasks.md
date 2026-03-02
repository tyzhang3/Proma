# Proma 移除 Chat 模块任务清单

## 目标

- 删除所有 Chat 相关代码与 UI，仅保留 Agent 主流程。
- 在删除过程中保证 Agent 功能可用，不引入额外复杂度。

## 执行原则

- 先解耦再删除：先抽离 Agent 复用组件，再删 Chat。
- 小步提交：每个阶段都可独立验证、可回滚。
- 优先简化结构：去掉双模式分支，避免保留无用抽象。

## 任务分阶段

### 阶段 0：基线与盘点

- [ ] 记录当前可用流程（Agent 会话创建、发送消息、附件、设置页）。
- [ ] 执行一次类型检查，保存基线结果。
- [ ] 建立分支并确认工作区干净。

验收标准：
- [ ] 当前主干可正常构建与运行。

---

### 阶段 1：抽离 Agent 复用组件（先做）

- [ ] 新建 `renderer/components/common/`（或等价目录）。
- [ ] 从 `components/chat/` 抽离以下复用组件到 common：
  - [ ] `UserAvatar`
  - [ ] `CopyButton`
  - [ ] `ModelSelector`
  - [ ] `AttachmentPreviewItem`
  - [ ] `formatMessageTime`（从 `ChatMessageItem` 拆到独立 util）
- [ ] 替换 Agent/Settings/ai-elements 中对 `components/chat/*` 的引用。

验收标准：
- [ ] Agent 页面不再依赖 `components/chat/*` 才能编译。

---

### 阶段 2：移除 Chat/Agent 双模式 UI

- [ ] 删除 `appModeAtom` 及相关分支逻辑。
- [ ] 删除 `ModeSwitcher` 组件与引用。
- [ ] `MainContentPanel` 固定渲染 `AgentView`（设置页逻辑保留）。
- [ ] `LeftSidebar` 删除 Chat 列表、置顶对话、Chat 新建入口，仅保留 Agent 会话列表。
- [ ] `SettingsPanel` 删除依赖 `appMode` 的条件渲染。
- [ ] `PromptSettings` 改为仅展示 Agent 提示词配置，去除 Chat Prompt 面板。

验收标准：
- [ ] UI 中不存在 Chat/Agent 切换入口。
- [ ] 主界面仅显示 Agent 工作流。

---

### 阶段 3：删除 Chat 前端状态与页面

- [ ] 删除 `renderer/components/chat/` 中 Chat 专属组件。
- [ ] 删除 `renderer/atoms/chat-atoms.ts`。
- [ ] 清理 `renderer/atoms/index.ts` 的 chat 导出。
- [ ] 清理 `window.__pendingAttachmentData` 等仅 Chat 使用的临时缓存声明。
- [ ] 全量搜索并清理 `chat-atoms` / `ChatView` / `onStream*` 等引用。

验收标准：
- [ ] Renderer 侧无 Chat 组件与 Chat 状态引用。

---

### 阶段 4：删除 Chat IPC / preload / main 服务

- [ ] 删除 `packages/shared/src/types/chat.ts` 中 Chat IPC 常量与类型（或迁移保留的通用类型）。
- [ ] `preload/index.ts` 删除 `chat:*` API 暴露与监听。
- [ ] `main/ipc.ts` 删除 `CHAT_IPC_CHANNELS` 相关 handler。
- [ ] 删除主进程 Chat 专属模块：
  - [ ] `chat-service.ts`
  - [ ] `conversation-manager.ts`
  - [ ] `chat-error-classifier.ts`
  - [ ] `chat-request-idempotency.ts`
  - [ ] 对应测试文件
- [ ] `main/index.ts` 删除 `stopAllGenerations` 调用。

验收标准：
- [ ] main / preload 不再包含 `chat:*` 通道。

---

### 阶段 5：收敛共享类型与附件能力

- [ ] 将 Agent 仍需使用的“通用文件能力”从 Chat 类型中拆到独立类型文件（如 `types/file.ts`）。
- [ ] 将文件选择/读取接口调整为通用或 Agent 命名，避免保留 Chat 命名语义。
- [ ] 保留并复用 `attachment-service` 中 Agent 仍需的能力，删除只为 Chat 服务的路径语义（如 conversation 维度目录）。
- [ ] 清理 `packages/shared/src/types/index.ts` 的 chat 导出。

验收标准：
- [ ] Shared 类型层无 Chat 残留导出。
- [ ] Agent 附件流程保持可用。

---

### 阶段 6：验证与文档更新

- [ ] 执行 `bun run --filter='@proma/electron' typecheck`。
- [ ] 执行 `bun run --filter='@proma/electron' build`。
- [ ] 手工 smoke：
  - [ ] 创建 Agent 会话
  - [ ] 发送消息
  - [ ] 上传附件/文件夹
  - [ ] 权限请求与 AskUser
  - [ ] 设置页（渠道、Agent 配置、记忆）
- [ ] 更新 README / 架构说明，移除 Chat 描述。

验收标准：
- [ ] 构建通过，关键 Agent 流程可用，文档与代码一致。

## 风险点（执行时重点关注）

- `components/chat` 目录中存在 Agent 复用组件，若直接删除会导致 Agent 页面损坏。
- `openFileDialog` 当前属于 Chat IPC 命名，但 Agent 仍依赖；必须先迁移接口再删 Chat IPC。
- `types/chat.ts` 包含附件与流式事件类型，删除前需拆分通用类型，避免 preload/main 大面积报错。

## 完成定义（DoD）

- [ ] 仓库中不再存在 Chat 页面与 Chat 模式状态。
- [ ] IPC、preload、main、shared 中不再有 `chat:` 相关通道和类型导出。
- [ ] Agent 关键链路可运行，且代码结构相比改造前更简单。
