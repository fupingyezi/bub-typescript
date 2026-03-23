# 工具调用处理逻辑修复规格

## Why
示例 `02_tools_auto_and_manual.ts` 执行时，手动模式 `toolCalls()` 返回空数组 `[]`，自动模式 `runTools()` 返回文本而非工具调用结果。这表明工具调用的解析或传输过程存在问题。

## What Changes
- 检查并修复 `ChatClient.toolCallsAsync` 中工具调用的提取逻辑
- 确保 `_unwrapResponse` 正确处理 LangChain 的 `AIMessage` 响应格式
- 确保 `extractToolCalls` 能正确从响应中提取工具调用
- 验证 `toolset.payload` 正确传递到 `runChat`

## Impact
- 受影响的规格：工具调用功能（手动模式和自动模式）
- 受影响的代码文件：
  - `packages/republic/src/clients/chat.ts`
  - `packages/republic/src/clients/parsing/completion.ts`
  - `packages/republic/src/core/execution.ts`

## 问题分析
根据调试输出：
1. `invokeOptions.tools` 正确包含工具定义
2. 模型返回了文本而非工具调用

可能原因：
1. `ChatClient._unwrapResponse` 可能未正确解包 LangChain 的 AIMessage 响应
2. `extractToolCalls` 可能无法正确解析响应格式
3. 响应可能被包装在额外的层级中

## ADDED Requirements

### Requirement: 正确解析 LangChain AIMessage 响应
系统 SHALL 能够正确解析 LangChain 返回的 AIMessage 格式响应。

#### Scenario: 解析包含 tool_calls 的 AIMessage
- **WHEN** LangChain 返回包含 `tool_calls` 的 AIMessage
- **THEN** `extractToolCalls` 应正确提取工具调用列表

#### Scenario: 解析纯文本响应
- **WHEN** 模型返回纯文本响应（无工具调用）
- **THEN** `toolCalls()` 应返回空数组

### Requirement: 修复 _unwrapResponse 解包逻辑
`_unwrapResponse` 应能正确识别并解包 LangChain 的 `AIMessage` 对象。

#### Scenario: 解包 AIMessage
- **WHEN** 响应是 LangChain 的 AIMessage 对象
- **THEN** 应正确提取其 `tool_calls` 属性

## MODIFIED Requirements

### Requirement: toolCallsAsync 返回值
`toolCallsAsync` 方法在收到模型响应后应返回正确的工具调用列表。

#### Scenario: 模型生成工具调用
- **WHEN** 模型生成工具调用请求
- **THEN** `toolCalls()` 应返回包含工具名称和参数的数组

#### Scenario: 模型未生成工具调用
- **WHEN** 模型直接返回文本回复
- **THEN** `toolCalls()` 应返回空数组 `[]`

### Requirement: runTools 自动执行
`runTools` 方法应自动执行模型请求的工具调用。

#### Scenario: 工具调用存在
- **WHEN** 模型生成了工具调用
- **THEN** `runTools()` 应自动执行工具并返回 `ToolAutoResult` 结果类型为 `"tools"`

#### Scenario: 无工具调用
- **WHEN** 模型未生成工具调用
- **THEN** `runTools()` 应返回文本结果
