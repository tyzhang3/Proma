# Proma macOS `.dmg` 打包说明

本文档用于**本地测试包**（不走正式发布流程），目标是快速生成可安装的 `.dmg`。

## 1. 前置条件

- 系统：macOS（建议 Apple Silicon / arm64）
- 已安装：`bun`
- 在仓库根目录执行：`/Users/tianyizhang/Documents/code/Proma`

可先检查：

```bash
bun --version
```

## 2. 一键生成测试 DMG（推荐）

```bash
cd apps/electron
PATH="$HOME/.bun/bin:$PATH" bun run scripts/dist.ts --current-arch --dmg --no-sign
```

参数说明：

- `--current-arch`：仅打当前机器架构（更快）
- `--dmg`：只产出 `.dmg`
- `--no-sign`：跳过签名（适合本地测试）

## 3. 产物位置

默认输出目录：

```text
apps/electron/out/
```

常见文件：

- `Proma-<version>-arm64.dmg`
- `Proma-<version>-arm64.dmg.blockmap`

示例：

```text
/Users/tianyizhang/Documents/code/Proma/apps/electron/out/Proma-0.5.0-arm64.dmg
```

## 4. 版本号控制（影响 DMG 文件名）

DMG 文件名里的 `<version>` 来自：

```text
apps/electron/package.json -> version
```

如果你希望生成 `0.5.1` 文件名，先改这里的版本号再打包。

## 5. 常用变体命令

仅当前架构 + 详细日志：

```bash
cd apps/electron
PATH="$HOME/.bun/bin:$PATH" bun run scripts/dist.ts --current-arch --dmg --no-sign --verbose
```

双架构（更慢）：

```bash
cd apps/electron
PATH="$HOME/.bun/bin:$PATH" bun run scripts/dist.ts --dmg --no-sign
```

## 6. 常见问题

### 1) `No packages matched the filter`

不要用 workspace filter 直接跑该脚本。请进入 `apps/electron` 目录执行 `bun run scripts/dist.ts ...`。

### 2) Gatekeeper 提示“无法验证开发者”

因为是未签名测试包。可在 macOS `系统设置 -> 隐私与安全性` 中允许打开，或右键 `Open` 首次启动。

### 3) 打包慢

优先使用 `--current-arch --dmg`；并确认 `apps/electron/vendor/bun` 已存在（脚本会自动检查）。
