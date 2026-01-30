# Compaction Tool Sanitization Patch

## 概述

本补丁修复了使用严格 API 代理（如 LiteLLM）时 compaction 请求失败的问题。

## 问题描述

### 症状

使用严格校验的 API 代理时，compaction 请求返回 400 错误：

```
API error 400: {"message":"Improperly formed request.","reason":null}
```

### 根本原因

- Compaction 请求发送时 `tools: {}` 是空的（故意的，因为 compaction 不需要调用工具）
- 但消息历史中包含了 `tool-call` 和 `tool-result` 内容
- 严格的 API 代理校验规则：如果消息中有 tool 相关内容，必须同时提供 tool definitions
- 代理看到"有 tool 消息 + 没有 tool 定义" → 拒绝请求

### 对比普通请求

普通请求同时提供消息历史和完整的 tools 定义，所以能通过校验。

## 解决方案

在 compaction 请求发送前，将消息中的 tool 相关内容转换为纯文本。

### 修改文件

`packages/opencode/src/session/compaction.ts`

### 核心改动

1. **新增 `sanitizeToolMessages()` 函数**：
   - 将 `role: 'tool'` 消息转换为 `role: 'user'` 文本消息（保留顺序，不过滤）
   - 将 assistant 消息中的 `tool-call` 和 `tool-result` parts 转换为 `text` parts
   - 保留 `toolCallId` 和 `toolName` 便于上下文关联

2. **在 compaction 请求中使用**：
   ```typescript
   messages: [
     ...sanitizeToolMessages(MessageV2.toModelMessages(input.messages, model)),
     // ...
   ]
   ```

## 技术细节

### AI SDK ModelMessage 类型约束

```typescript
type ModelMessage = SystemModelMessage | UserModelMessage | AssistantModelMessage | ToolModelMessage

// ToolModelMessage.content 必须是 Array<ToolResultPart>，不能是 string
type ToolModelMessage = {
  role: "tool"
  content: ToolContent // Array<ToolResultPart>
}
```

### 关键字段名

- AI SDK 使用 `input` 而不是 `args`
- AI SDK 使用 `output` 而不是 `result`
- `output` 可能是联合类型：`{type: "text", value: "..."}` 或 `{type: "json", value: {...}}`

### 截断策略

- Tool call input: 200 字符
- Tool result output: 300 字符
- 使用 `...[truncated]` 后缀标识截断

## 完整补丁

```diff
diff --git a/packages/opencode/src/session/compaction.ts b/packages/opencode/src/session/compaction.ts
--- a/packages/opencode/src/session/compaction.ts
+++ b/packages/opencode/src/session/compaction.ts
@@ -14,10 +14,96 @@ import { fn } from "@/util/fn"
 import { Agent } from "@/agent/agent"
 import { Plugin } from "@/plugin"
 import { Config } from "@/config/config"
+import type { ModelMessage } from "ai"

 export namespace SessionCompaction {
   const log = Log.create({ service: "session.compaction" })

+  function safeStringify(value: unknown): string {
+    if (typeof value === "string") return value
+    if (value === undefined || value === null) return ""
+    try {
+      return JSON.stringify(value) ?? ""
+    } catch {
+      return "[unserializable]"
+    }
+  }
+
+  function extractOutput(output: unknown): string {
+    if (!output || typeof output !== "object") return safeStringify(output)
+    const o = output as Record<string, unknown>
+    if (o.type === "text" && typeof o.value === "string") return o.value
+    if (o.type === "json") return safeStringify(o.value)
+    return safeStringify(output)
+  }
+
+  function sanitizeToolMessages(messages: ModelMessage[]): ModelMessage[] {
+    return messages.map((msg): ModelMessage => {
+      if (msg.role === "tool") {
+        const texts: string[] = []
+        if (Array.isArray(msg.content)) {
+          for (const part of msg.content) {
+            if (!part || typeof part !== "object") continue
+            if (part.type === "tool-result") {
+              const id = "toolCallId" in part ? part.toolCallId : ""
+              const name = "toolName" in part ? part.toolName : "unknown"
+              const raw = extractOutput("output" in part ? part.output : "")
+              const result = raw.length > 300 ? raw.slice(0, 300) + "...[truncated]" : raw
+              texts.push(`[Tool Result${id ? ` (${id})` : ""} ${name}: ${result}]`)
+            }
+          }
+        }
+        return {
+          role: "user",
+          content: texts.join("\n") || "[Tool result converted to text]",
+        }
+      }
+
+      if (typeof msg.content === "string") return msg
+      if (!Array.isArray(msg.content)) return msg
+
+      if (msg.role === "assistant") {
+        const newContent = msg.content.map((part) => {
+          if (!part || typeof part !== "object") return part
+          if (part.type === "tool-call") {
+            const id = "toolCallId" in part ? part.toolCallId : ""
+            const name = "toolName" in part ? part.toolName : "unknown"
+            const raw = safeStringify("input" in part ? part.input : "")
+            const input = raw.length > 200 ? raw.slice(0, 200) + "...[truncated]" : raw
+            return { type: "text" as const, text: `[Tool Call${id ? ` (${id})` : ""}: ${name}(${input})]` }
+          }
+          if (part.type === "tool-result") {
+            const id = "toolCallId" in part ? part.toolCallId : ""
+            const name = "toolName" in part ? part.toolName : "unknown"
+            const raw = extractOutput("output" in part ? part.output : "")
+            const result = raw.length > 300 ? raw.slice(0, 300) + "...[truncated]" : raw
+            return { type: "text" as const, text: `[Tool Result${id ? ` (${id})` : ""} ${name}: ${result}]` }
+          }
+          return part
+        })
+        return { ...msg, content: newContent }
+      }
+
+      return msg
+    })
+  }
+
   export const Event = {
@@ -149,7 +235,7 @@ export namespace SessionCompaction {
       tools: {},
       system: [],
       messages: [
-        ...MessageV2.toModelMessages(input.messages, model),
+        ...sanitizeToolMessages(MessageV2.toModelMessages(input.messages, model)),
         {
           role: "user",
           content: [
```

## 应用补丁步骤

### 方法一：手动应用

1. 打开 `packages/opencode/src/session/compaction.ts`
2. 添加 import: `import type { ModelMessage } from "ai"`
3. 在 namespace 内添加 `safeStringify`、`extractOutput`、`sanitizeToolMessages` 三个函数
4. 修改 `process` 函数中的 messages 调用

### 方法二：使用 git patch

```bash
git apply compaction-tool-sanitization.patch
```

### 编译

```bash
cd packages/opencode
bun run script/build.ts
```

### 替换已安装的 opencode

```bash
# Windows
copy "dist\opencode-windows-x64\bin\opencode.exe" "%APPDATA%\npm\node_modules\opencode-ai\node_modules\opencode-windows-x64\bin\opencode.exe"

# macOS (Apple Silicon)
cp dist/opencode-darwin-arm64/bin/opencode ~/.npm/lib/node_modules/opencode-ai/node_modules/opencode-darwin-arm64/bin/opencode

# macOS (Intel)
cp dist/opencode-darwin-x64/bin/opencode ~/.npm/lib/node_modules/opencode-ai/node_modules/opencode-darwin-x64/bin/opencode

# Linux
cp dist/opencode-linux-x64/bin/opencode ~/.npm/lib/node_modules/opencode-ai/node_modules/opencode-linux-x64/bin/opencode
```

## 注意事项

1. **OpenCode 更新后需要重新应用**：npm 升级会覆盖二进制文件
2. **跨平台编译**：需要在目标平台上编译，或使用 `--single` 参数只编译当前平台
3. **备份原文件**：替换前建议备份原始 opencode 可执行文件

## 验证

修复后验证：

- [ ] 不再报 `AI_InvalidPromptError`（AI SDK 本地校验）
- [ ] 不再报 API 400 错误（代理校验）
- [ ] Compaction 功能正常工作
- [ ] 摘要内容包含 tool 调用的上下文信息
