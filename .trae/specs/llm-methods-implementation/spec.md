# LLM 类未实装方法实现规格

## Why
`LLM` 类中当前存在 6 个抛出 "not implemented" 错误的方法，需要根据现有代码逻辑进行实装：
- `toolCalls` / `toolCallsAsync`
- `runTools` / `runToolsAsync`
- `streamEvents` / `streamEventsAsync`

## What Changes
- 实现 `ChatClient` 中的 `toolCallsAsync` 方法以支持工具调用
- 在 `LLM` 类中实现 `toolCalls`、`toolCallsAsync`、`runTools`、`runToolsAsync`、`streamEvents`、`streamEventsAsync` 方法
- 利用 `ChatClient` 和 `ToolExecutor` 的现有功能实现完整逻辑

## Impact
- 受影响的功能：LLM 类的工具调用、流式事件处理
- 受影响的代码文件：
  - `packages/republic/src/llm.ts`
  - `packages/republic/src/clients/chat.ts`

## ADDED Requirements

### Requirement: toolCalls 方法实现
LLM 类的 `toolCalls` 方法应返回 `Record<string, any>[]`，代表模型生成的工具调用列表。

#### Scenario: 基本工具调用
- **WHEN** 用户调用 `llm.toolCalls(prompt, { tools })`
- **THEN** 系统执行聊天并返回工具调用列表

#### Scenario: 带 Tape 的工具调用
- **WHEN** 用户调用 `llm.toolCalls(prompt, { tools, tape: "session1" })`
- **THEN** 系统从指定 Tape 读取历史消息，执行聊天并返回工具调用列表

### Requirement: toolCallsAsync 方法实现
`toolCallsAsync` 是 `toolCalls` 的异步版本，应返回 `Promise<Record<string, any>[]>`。

#### Scenario: 异步工具调用
- **WHEN** 用户调用 `await llm.toolCallsAsync(prompt, { tools })`
- **THEN** 系统异步执行聊天并返回工具调用列表

### Requirement: runTools 方法实现
`runTools` 方法应自动执行工具调用并返回 `ToolAutoResult`。

#### Scenario: 自动工具执行
- **WHEN** 用户调用 `llm.runTools(prompt, { tools })`
- **THEN** 系统执行聊天、提取工具调用、执行工具并返回 `ToolAutoResult`

### Requirement: runToolsAsync 方法实现
`runToolsAsync` 是 `runTools` 的异步版本，应返回 `Promise<ToolAutoResult>`。

#### Scenario: 异步自动工具执行
- **WHEN** 用户调用 `await llm.runToolsAsync(prompt, { tools })`
- **THEN** 系统异步执行聊天、提取工具调用、执行工具并返回 `ToolAutoResult`

### Requirement: streamEvents 方法实现
`streamEvents` 方法应返回 `AsyncStreamEvents`，支持流式处理事件。

#### Scenario: 流式事件处理
- **WHEN** 用户调用 `llm.streamEvents(prompt, { tools })`
- **THEN** 系统返回包含工具调用事件的 `AsyncStreamEvents`

### Requirement: streamEventsAsync 方法实现
`streamEventsAsync` 是 `streamEvents` 的异步版本，应返回 `Promise<AsyncStreamEvents>`。

#### Scenario: 异步流式事件处理
- **WHEN** 用户调用 `await llm.streamEventsAsync(prompt, { tools })`
- **THEN** 系统异步返回包含工具调用事件的 `AsyncStreamEvents`

## MODIFIED Requirements

### Requirement: ChatClient 扩展
扩展 `ChatClient` 类以支持工具调用相关方法。

#### Scenario: 创建 ChatClient 时需要的方法
- **WHEN** `LLM` 构造函数创建 `ChatClient` 实例
- **THEN** `ChatClient` 应提供完整的方法支持工具调用
