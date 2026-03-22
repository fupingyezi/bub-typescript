# ChatClient 流式传输支持修复规格

## Why
`runChat` 方法之前接收 `stream` 和 `streamMode` 参数，但调用方总是传入硬编码值，无法根据用户配置的 `apiFormat` 和 `streamMode` 动态启用流式传输。

## What Changes
- `runChat` 方法直接使用 `LLMCore` 实例的 `_api_format` 和 `_stream_mode` 属性
- 移除 `runChat` 的 `stream` 和 `streamMode` 参数
- 调用方无需传递这些参数，由 `LLMCore` 实例统一管理

## Impact
- 受影响的代码文件：
  - `packages/republic/src/core/execution.ts`
  - `packages/republic/src/llm.ts`
  - `packages/republic/src/clients/chat.ts`

## MODIFIED Requirements

### Requirement: runChat 直接使用实例属性
`runChat` 方法应直接使用 `this._api_format` 和 `this._stream_mode` 属性来决定流式传输行为。

#### Scenario: apiFormat 为 stream
- **WHEN** `this._api_format === "stream"`
- **THEN** 启用流式传输

#### Scenario: apiFormat 为 invoke
- **WHEN** `this._api_format === "invoke"`
- **THEN** 不启用流式传输
