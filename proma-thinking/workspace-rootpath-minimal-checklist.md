# 可选工作目录（工作区）能力：最小改动清单

> 目标：在现有工作区机制上，支持用户为工作区绑定一个本地目录（rootPath），并让 Agent 会话在该目录下运行；在不破坏现有行为的前提下逐步增强“仅在目录内执行”的约束。

## 0. 范围与原则

- **向后兼容**：历史工作区未设置 `rootPath` 时，继续使用现有目录策略。
- **最小侵入**：先打通数据流（UI → IPC → Main → Orchestrator），再补强约束能力。
- **可回滚**：保留“恢复默认目录”能力，出现路径失效时自动降级。

---

## 1. 数据结构（shared）

### 1.1 修改类型定义

文件：`packages/shared/src/types/agent.ts`

- 在 `AgentWorkspace` 中新增：
  - `rootPath?: string`：工作区绑定的绝对路径。
  - `cwdMode?: 'workspace-root' | 'session-subdir'`：cwd 策略（先默认 `workspace-root`）。

### 1.2 IPC 入参补充

文件：`packages/shared/src/types/agent.ts`

- 新增/扩展工作区更新入参类型：
  - `AgentUpdateWorkspaceInput`（若不存在则新增）支持 `rootPath`、`cwdMode`。

验收：

- `pnpm/bun typecheck`（或项目现有类型检查命令）通过。

---

## 2. 工作区持久化（main）

### 2.1 workspace manager 扩展

文件：`apps/electron/src/main/lib/agent-workspace-manager.ts`

- 在 `createAgentWorkspace` 写入默认字段：
  - `rootPath` 缺省为 `undefined`。
  - `cwdMode` 缺省为 `'workspace-root'`（或不落盘但读取时补默认）。
- 扩展 `updateAgentWorkspace` 以支持：
  - 更新 `name`
  - 更新 `rootPath`
  - 更新 `cwdMode`
- 增加路径校验函数：
  - 必须是绝对路径
  - 目录存在且可访问
  - 失败时抛出可读错误信息（用于 UI toast）

### 2.2 目录健康检查

文件：`apps/electron/src/main/lib/agent-workspace-manager.ts`

- 在 `list/get` 读取时可选补充：
  - 若 `rootPath` 已失效，标记状态（可新增 `rootPathInvalid?: boolean`）或在日志提示。

验收：

- 更新工作区 rootPath 后重启应用，配置仍存在。

---

## 3. IPC 与 preload 桥接

### 3.1 IPC handler

文件：`apps/electron/src/main/ipc.ts`

- 复用现有 `UPDATE_WORKSPACE` 通道，允许携带 `rootPath/cwdMode`。
- 新增可选通道（如需要）：
  - `AGENT_IPC_CHANNELS.PICK_WORKSPACE_DIR`（主进程用 dialog 返回目录）

### 3.2 preload 暴露 API

文件：`apps/electron/src/preload/index.ts`

- 扩展 `updateAgentWorkspace` 类型与实现。
- 如有目录选择通道，暴露：
  - `pickWorkspaceDirectory(): Promise<string | null>`

验收：

- renderer 能拿到目录并调用更新 API 成功。

---

## 4. UI 交互（renderer）

### 4.1 工作区设置入口

文件（建议其一）：

- `apps/electron/src/renderer/components/agent/WorkspaceSelector.tsx`
- 或新增 `WorkspaceSettings` 组件并在 Agent 页面挂载

功能：

- 「选择目录」按钮：调用 `pickWorkspaceDirectory`。
- 展示当前目录（可截断显示，hover 显示完整路径）。
- 「恢复默认目录」按钮：将 `rootPath` 清空。
- 「cwd 策略」单选：
  - 工作区根目录（workspace-root）
  - 会话子目录（session-subdir）

交互细节：

- 更新成功后刷新 workspace 列表 atom。
- 失败时 toast/alert，提示路径无效或无权限。

验收：

- 可视化切换目录并持久化。

---

## 5. Orchestrator 的 cwd 决策（核心）

文件：`apps/electron/src/main/lib/agent-orchestrator.ts`

在构建 `queryOptions` 前，按以下顺序计算 `agentCwd`：

1. 若存在 `workspaceId` 且 workspace 有 `rootPath`：
   - `cwdMode === 'workspace-root'` → `agentCwd = rootPath`
   - `cwdMode === 'session-subdir'` → `agentCwd = join(rootPath, sessionId)`（不存在则创建）
2. 否则走现有逻辑：`~/.proma/agent-workspaces/{slug}/{sessionId}`
3. 最终将 `agentCwd` 传给 Adapter（保持现有接口）

验收：

- 日志可看到新 cwd 分支被命中。
- 旧工作区行为不变。

---

## 6. 会话创建与附件行为对齐

### 6.1 会话目录创建策略

文件：`apps/electron/src/main/lib/agent-session-manager.ts`

- 当 `cwdMode = session-subdir` 时，创建会话即创建 `rootPath/sessionId`。
- 当 `cwdMode = workspace-root` 时可不额外创建子目录。

### 6.2 上传/复制文件目录

文件：`apps/electron/src/main/lib/agent-service.ts`

- `saveFilesToAgentSession` 与 `copyFolderToSession` 目标目录应复用“统一 cwd 解析函数”，避免与 orchestrator 不一致。

验收：

- 附件落盘位置与 Agent 实际 cwd 一致。

---

## 7. “只在目录内运行”约束（建议第二阶段）

### 7.1 软约束

文件：`apps/electron/src/main/lib/agent-orchestrator.ts`（system prompt append）

- 明确要求工具仅读写 `agentCwd` 内路径，越界先 ask user。

### 7.2 硬约束

文件：

- `apps/electron/src/main/lib/permission-service.ts`
- 或工具调用拦截层（`canUseTool` 回调附近）

实现：

- 对工具输入路径做 `realpath` + 前缀校验：
  - 不在 allowed root 内则拒绝执行并返回结构化错误。

验收：

- 构造越界路径（如 `../`、符号链接）可被稳定拦截。

---

## 8. 测试建议（最小集）

### 8.1 单元测试

- `agent-workspace-manager`：
  - rootPath 合法/非法校验
  - 更新字段向后兼容
- `cwd resolver`（建议抽函数）：
  - `workspace-root` / `session-subdir` / fallback 分支

### 8.2 集成验证

- 新建工作区 → 绑定目录 → 新建会话 → 发送消息
- 上传文件后，确认与日志 cwd 一致
- 删除/重命名工作区不影响 rootPath 绑定一致性

---

## 9. 里程碑与交付

### M1（1~2 天）

- 类型 + manager + ipc/preload 打通 rootPath 字段

### M2（1~2 天）

- renderer 目录选择 UI + 持久化 + 错误提示

### M3（1 天）

- orchestrator cwd 决策切换 + 附件目录统一

### M4（1~2 天）

- 越界防护最小版（路径校验）+ 回归测试

---

## 10. 完成定义（DoD）

- 用户可在工作区维度选择/修改目录。
- 新会话的任务默认在目标目录执行。
- 历史工作区与会话行为不回归。
- 目录失效有清晰提示与降级策略。
- （第二阶段）越界路径可被拦截。

---

## 11. 实施节奏（每步必须 Code Review + 修复后再前进）

> 执行原则：每完成一个里程碑（M1~M4）都要走完“开发 → CI → Code Review → 修复缺陷 → 回归验证”闭环，**未关闭缺陷不得进入下一步**。

### 11.1 单步闭环流程（Gate）

每个里程碑都按以下 Gate 执行：

1. **开发完成**：仅提交当前里程碑范围内代码。
2. **本地验证**：运行该里程碑对应测试与 lint/typecheck。
3. **提交 PR（小步）**：PR 标题标注里程碑（如 `M2: workspace picker UI`）。
4. **Code Review**：至少关注以下维度：
   - 向后兼容与迁移风险
   - 异常路径（目录不存在/权限不足/路径越界）
   - 数据流一致性（UI/IPC/Main/Orchestrator）
5. **修复缺陷**：review 评论和测试暴露的问题必须修复并补充测试。
6. **回归验证通过**：该里程碑 CI 绿灯后，才允许进入下一里程碑。

### 11.2 Review Checklist（每个里程碑都复用）

- 是否引入破坏性字段变更（老数据能否读取）
- 是否存在路径平台兼容问题（Windows/macOS/Linux）
- 是否存在相同能力在多处实现导致不一致
- 是否补齐单元测试/集成验证
- 错误信息是否可被用户理解（非纯技术栈报错）

---

## 12. CI 方案（新增与落地建议）

目标：让每个里程碑在合并前都能自动发现类型错误、逻辑回归和关键路径故障。

### 12.1 CI 任务矩阵（建议）

在 `.github/workflows/` 增加或扩展 `agent-workspace-rootpath.yml`：

1. `lint-and-typecheck`
   - 安装依赖（bun）
   - 运行 lint
   - 运行 typecheck
2. `unit-tests`
   - 运行与 `agent-workspace-manager`、`cwd resolver` 相关单测
3. `integration-tests`（可先 smoke）
   - 验证 workspace -> session -> cwd 主链路
4. `build-check`
   - 构建 electron app（至少确保编译通过）

### 12.2 分阶段启用策略

- **M1 起**：必须开启 `lint-and-typecheck` + `unit-tests`
- **M2 起**：补充 renderer 相关测试（如有）
- **M3 起**：强制 `integration-tests`（至少 1 条主链路）
- **M4 起**：增加路径越界安全测试（`../`、软链）

### 12.3 分支保护建议

- Required checks：`lint-and-typecheck`、`unit-tests`、`build-check`
- PR 必须至少 1 位 reviewer approval
- 禁止直接 push main（必须走 PR）

---

## 13. 全量完成后的统一 Review 与缺陷收敛

> 在 M1~M4 全部通过后，再做一次“统一 Review + 统一修复”。

### 13.1 统一 Review 范围

- 端到端一致性：workspace 配置、会话创建、附件落盘、Agent cwd
- 安全一致性：软约束提示与硬约束拦截是否互补
- 可维护性：是否已抽出统一 `cwd resolver`，避免多处分叉
- 可观测性：关键日志是否足够定位问题

### 13.2 统一缺陷修复批次

- 建议开一个收敛 PR（例如 `stabilize: workspace rootPath rollout`）
- 仅包含：
  - review 遗留问题修复
  - flaky 测试修复
  - 文档与注释补全
- 合并前执行完整 CI（含集成测试）与一次人工冒烟。

### 13.3 最终发布前检查（Release Gate）

- 所有必需 CI checks 为绿
- 无 P0/P1 未关闭缺陷
- 回滚方案验证可用（清空 `rootPath` 回到默认策略）
- 发布说明包含：已知限制、迁移行为、风险提示
