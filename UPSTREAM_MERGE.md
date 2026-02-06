# 上游合并指南

本仓库 fork 自 [anomalyco/opencode](https://github.com/anomalyco/opencode)。

## 我的自定义修改

### 1. Session Compaction 功能（基于 Anchor）

增强了 compaction 机制，添加了 anchor 选择和 budget 管理功能。

**修改的文件：**

| 文件                                                | 修改内容                                                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `packages/opencode/src/session/compaction.ts`       | 添加了 `selectAnchor()`、`messagePayload()`、`messageTokens()` 函数；`SUMMARY_BUDGET` 和 `PRESERVE_BUDGET` 常量 |
| `packages/opencode/src/session/message-v2.ts`       | 在 `CompactionPart` 中添加了 `anchorMessageID` 字段；更新了 `filterCompacted()` 支持基于 anchor 的过滤          |
| `packages/opencode/test/session/compaction.test.ts` | 添加了 `isOverflow`、`selectAnchor`、token 估算的测试                                                           |

**关键提交：**

- `b174d4585` - feat: add anchorMessageID support to CompactionPart
- `83747d61f` - feat: implement session compaction with anchor selection and budget management
- `1fc727475` - test: add comprehensive tests for session compaction

### 2. Workflow 文件（可选）

之前删除了 `.github/workflows/test.yml` 以避免 CI 冲突。在 v1.1.53 合并时已恢复。

---

## 合并前检查清单

合并上游前，检查这些文件是否有冲突：

```bash
# 如果还没添加 upstream，先添加
git remote add upstream https://github.com/anomalyco/opencode.git

# 获取最新代码
git fetch upstream

# 检查上游对我修改的文件有什么改动（从上次合并到现在）
git diff <上次合并的commit>..upstream/dev -- \
  packages/opencode/src/session/compaction.ts \
  packages/opencode/src/session/message-v2.ts \
  packages/opencode/test/session/compaction.test.ts \
  packages/opencode/src/agent/prompt/compaction.txt
```

### 需要重点关注的文件

| 文件                 | 风险等级 | 原因                                                 |
| -------------------- | -------- | ---------------------------------------------------- |
| `compaction.ts`      | 高       | 核心 compaction 逻辑，我的 anchor 选择功能在这里     |
| `message-v2.ts`      | 高       | 我的 `anchorMessageID` 字段和 `filterCompacted` 修改 |
| `compaction.txt`     | 中       | Compaction 提示词，影响摘要质量                      |
| `compaction.test.ts` | 低       | 我的测试，不太可能冲突                               |

---

## 合并工作流程

```bash
# 1. 获取上游代码
git fetch upstream

# 2. 查看有什么新内容
git log --oneline <上次合并commit>..upstream/dev | head -30

# 3. 专门检查 compaction 相关的改动
git log --oneline <上次合并commit>..upstream/dev | grep -i "compact"
git diff <上次合并commit>..upstream/dev -- packages/opencode/src/session/compaction.ts

# 4. 尝试合并（先不提交）
git merge upstream/dev --no-commit --no-ff

# 5. 检查冲突
git diff --name-only --diff-filter=U

# 6. 如果 compaction 文件有冲突，仔细解决，保留：
#    - CompactionPart 中的 anchorMessageID 字段
#    - selectAnchor() 函数及相关辅助函数
#    - filterCompacted() 中基于 anchor 的逻辑

# 7. 完成合并
git commit -m "chore: merge upstream/dev (vX.X.X) - keep compaction feature"
```

---

## 合并历史

| 日期       | 上游版本 | 冲突                                 | 备注                           |
| ---------- | -------- | ------------------------------------ | ------------------------------ |
| 2026-02-03 | v1.1.49  | `.github/workflows/test.yml`（删除） | 首次合并，包含 compaction 功能 |
| 2026-02-06 | v1.1.53  | `.github/workflows/test.yml`（恢复） | compaction 无冲突              |

---

## 上游 Compaction 改动需要注意的点

如果上游修改了 compaction，注意以下几点：

1. **CompactionPart schema 变更** - 可能需要与我的 `anchorMessageID` 合并
2. **filterCompacted() 逻辑** - 我的基于 anchor 的过滤可能会冲突
3. **compaction.ts 中的 process() 函数** - 我的 anchor 选择集成在这里
4. **提示词变更** - 可能需要采用上游的改进

---

## 常用命令

```bash
# 查找上次合并的 commit
git log --oneline --merges -5

# 查看上游 compaction 相关的提交
git log upstream/dev --oneline | grep -i compact

# 对比我的 compaction.ts 和上游的差异
git diff HEAD..upstream/dev -- packages/opencode/src/session/compaction.ts
```

---

## 编译工作流程

合并上游代码后，需要重新编译 `opencodexx`。

### 编译步骤

```bash
# 1. 进入 opencode 包目录
cd packages/opencode

# 2. 安装依赖（如果需要）
bun install

# 3. 编译新版本（设置版本号环境变量）
OPENCODE_VERSION="X.X.X.xxfork" bun run build --single

# 4. 安装到本地 bin 目录
cp dist/opencode-darwin-arm64/bin/opencode ~/.local/bin/opencodexx

# 5. 重新签名（macOS 必须，否则会被 kill）
codesign --force --sign - ~/.local/bin/opencodexx
xattr -cr ~/.local/bin/opencodexx

# 6. 验证版本
~/.local/bin/opencodexx --version
```

### 一键编译脚本

```bash
# 在项目根目录执行
cd packages/opencode && \
OPENCODE_VERSION="X.X.X.xxfork" bun run build --single && \
cp dist/opencode-darwin-arm64/bin/opencode ~/.local/bin/opencodexx && \
codesign --force --sign - ~/.local/bin/opencodexx && \
xattr -cr ~/.local/bin/opencodexx && \
~/.local/bin/opencodexx --version
```

### 版本号命名规范

- 格式：`{上游版本}.xxfork`
- 示例：`1.1.53.xxfork`
- 上游版本号可在 `packages/opencode/package.json` 中查看

### 编译历史

| 日期       | 版本号        | 备注                    |
| ---------- | ------------- | ----------------------- |
| 2026-02-03 | 1.1.49.xxfork | 首次编译                |
| 2026-02-06 | 1.1.53.xxfork | 合并上游 v1.1.53 后编译 |

### 常见问题

**Q: 运行时被 kill (`zsh: killed`)**

A: macOS 安全机制导致，需要重新签名：

```bash
codesign --force --sign - ~/.local/bin/opencodexx
xattr -cr ~/.local/bin/opencodexx
```

**Q: 编译时找不到模块**

A: 先安装依赖：

```bash
cd packages/opencode && bun install
```
