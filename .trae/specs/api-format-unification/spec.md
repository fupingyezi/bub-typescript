# API Format 统一为 LangChain 调用模式规格

## Why
当前 `LLM` 类的 `apiFormat` 选项仍使用旧值（`"auto"`, `"completion"`, `"response"`, `"messages"`），而 `execution.ts` 已更新为 langchain 调用模式（`invoke` / `stream`），且 `stream` 支持三种模式（`"messages"`, `"updates"`, `"values"`）。需要统一所有文件使用 langchain 的调用模式。

## What Changes
- 修改 `LLM` 构造函数中 `apiFormat` 的类型定义和验证逻辑
- `apiFormat` 选项从 `"auto" | "completion" | "response" | "messages"` 改为 `"invoke" | "stream"`
- `stream` 模式通过独立参数 `streamMode` 指定三种模式：`"messages" | "updates" | "values"`
- 更新相关注释和文档

## Impact
- 受影响的规格：LLM 类的 API 调用方式
- 受影响的代码文件：
  - `packages/republic/src/llm.ts`

## MODIFIED Requirements

### Requirement: LLM 构造函数 apiFormat 选项
LLM 构造函数的 `apiFormat` 选项应支持 langchain 调用模式。

#### Scenario: invoke 模式
- **WHEN** 用户创建 `LLM` 实例时设置 `apiFormat: "invoke"`
- **THEN** 系统使用非流式调用（`client.invoke`）

#### Scenario: stream 模式
- **WHEN** 用户创建 `LLM` 实例时设置 `apiFormat: "stream"`
- **THEN** 系统使用流式调用（`client.stream`）

#### Scenario: streamMode 参数
- **WHEN** 用户在调用 `stream` / `streamEvents` 方法时设置 `streamMode: "messages" | "updates" | "values"`
- **THEN** 系统根据指定模式处理流式响应

### Requirement: apiFormat 验证
`apiFormat` 必须是 `"invoke"` 或 `"stream"` 之一，不再支持旧值。

#### Scenario: 无效 apiFormat
- **WHEN** 用户设置 `apiFormat` 为 `"auto"`, `"completion"`, `"response"`, 或 `"messages"`
- **THEN** 系统抛出错误：`"apiFormat must be 'invoke' or 'stream'"`

## REMOVED Requirements

### Requirement: 旧 apiFormat 值
**Reason**: langchain 调用模式已更新为 `invoke` / `stream` 方式
**Migration**: 使用 `"invoke"` 替代 `"completion"`，使用 `"stream"` 替代 `"response"` 或 `"messages"`