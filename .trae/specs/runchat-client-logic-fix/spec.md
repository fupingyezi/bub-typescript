# runChat 客户端调用逻辑修复规格

## Why
`runChat` 方法的设计意图是遍历不同 provider 和 model 的客户端实例进行调用，但实际上 `iterClients` 和 `getClient` 的实现存在问题：
- `iterClients` 遍历时传入了不同的 `[providerName, modelId]`
- 但 `getClient(provider)` 只根据 provider 获取客户端实例
- 导致相同 provider 不同 model 的情况下，获取到的是同一个 client 实例
- `_callClient` 方法虽然接收 `modelId` 参数，但并未实际使用该参数配置到调用中

## What Changes
- 修改 `getClient` 方法，使其能够根据 `[provider, model]` 组合获取对应的客户端实例
- 确保每个不同的 `[provider, model]` 组合都能获取到正确配置的 client
- 在 client 缓存层面支持按 `[provider, model]` 缓存

## Impact
- 受影响的代码文件：`packages/republic/src/core/execution.ts`
- 受影响的方法：`getClient`、`iterClients`、`_callClient`

## MODIFIED Requirements

### Requirement: getClient 方法按 [provider, model] 获取客户端
`getClient` 方法应能够根据 provider 和 model 组合获取对应的客户端实例。

#### Scenario: 不同 provider 相同 model
- **WHEN** 调用 `getClient("openai")` 和 `getClient("anthropic")` 时
- **THEN** 应返回各自 provider 独立配置的客户端实例

#### Scenario: 相同 provider 不同 model
- **WHEN** 调用 `getClient("openai")` 时，LLMCore 中配置了多个不同的 model
- **THEN** 应返回各自 model 独立配置的客户端实例

### Requirement: _callClient 应使用 modelId 配置调用
`_callClient` 方法应使用传入的 `modelId` 参数配置 LangChain 客户端的模型。

#### Scenario: 调用时指定 modelId
- **WHEN** `runChat` 遍历到 `[providerName, modelId, client]` 时
- **THEN** `_callClient` 应该使用 `modelId` 配置调用选项中的模型

### Requirement: 客户端缓存键应包含 model 信息
客户端缓存键应能够区分同一 provider 下不同 model 的客户端实例。

#### Scenario: 缓存键生成
- **WHEN** `getClient` 方法生成缓存键时
- **THEN** 缓存键应同时包含 provider 和 model 信息
