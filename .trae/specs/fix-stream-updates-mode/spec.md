# Updates 模式下流处理 Bug 修复规格

## Why
当使用 `streamMode: "updates"` 时，流式响应处理不正确。从运行结果看：
- `messages` 模式：正常工作，接收 22 个文本块
- `updates` 模式：只接收到 1 个事件（FINAL），没有文本内容
- `values`  模式：正常工作，接收 13 个事件

这说明 `_processStreamChunk` 函数在 `updates` 模式下没有正确提取数据。

## What Changes
- 修改 `_processStreamChunk` 函数中 `updates` 模式的处理逻辑
- 确保正确提取 LangChain AIMessageChunk 的文本内容

## Impact
- 受影响的代码：`packages/republic/src/clients/chat.ts`
- 受影响的解析器：`packages/republic/src/clients/parsing/completion.ts`

## MODIFIED Requirements

### Requirement: _processStreamChunk 处理 updates 模式
当 `streamMode === "updates"` 时，系统应正确处理 LangChain 流式响应。

#### Scenario: updates 模式提取文本
- **WHEN** 流式响应使用 `updates` 模式且数据块是 LangChain AIMessageChunk
- **THEN** 系统应从 `chunk.content` 或其他有效属性中提取文本

### Requirement: CompletionTransportParser 处理 LangChain 格式
CompletionTransportParser 应能处理 LangChain 的 AIMessageChunk 格式。

#### Scenario: 从 AIMessageChunk 提取文本
- **WHEN** 数据块是 LangChain AIMessageChunk（具有 `content` 属性）
- **THEN** `extractChunkText` 应正确提取文本内容
