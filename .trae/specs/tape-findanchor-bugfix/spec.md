# Tape findAnchorIndex Bug 修复规范

## Why

`findAnchorIndex` 函数在 `store.ts` 中用于查找锚点索引，但当 `name = null` 时（表示查找任意锚点，即 LAST_ANCHOR 场景），逻辑存在严重 bug。

**预期行为**：当 `name = null` 时，应查找**任意锚点**（不管锚点名称是什么），找到第一个匹配的锚点。

**实际行为**：`!name` 在 `name = null` 时为 `true`，导致条件 `entry.payload.name !== null` 永远为 `true`（因为锚点都有名字），所有锚点都被跳过，最终返回 `defaultIndex`（-1）。

## What Changes

- 修复 `store.ts` 中 `findAnchorIndex` 函数的逻辑错误
- 条件判断从 `!name && entry.payload.name !== name` 改为 `name !== null && entry.payload.name !== name`
- 确保当 `name = null` 时能正确查找任意锚点

## Impact

- 受影响的代码文件：`packages/republic/src/tape/store.ts`
- 受影响的方法：`findAnchorIndex`
- 受影响的功能：Tape 的 `lastAnchor()` 查询功能、多轮对话上下文保持

## ADDED Requirements

### Requirement: findAnchorIndex 正确处理 LAST_ANCHOR 场景

#### Scenario: LAST_ANCHOR 查找（name = null）
- **WHEN** 调用 `findAnchorIndex(entries, null, -1, false)` 查找最后一个锚点
- **THEN** 应返回最后一个锚点的索引，而不是 -1
- **原因**：LAST_ANCHOR 表示查找任意锚点，不关心名称

#### Scenario: 指定名称锚点查找（name = "锚点名"）
- **WHEN** 调用 `findAnchorIndex(entries, "specific-anchor", -1, false)`
- **THEN** 应返回名为 "specific-anchor" 的锚点索引

## 修复方案

```typescript
// store.ts 第 45 行和第 52 行

// 错误写法：
if (!name && entry.payload.name !== name) continue;

// 当 name = null 时：
// !name = true（null 被当作 falsy）
// 条件变为：entry.payload.name !== null
// 这会跳过所有有名字的锚点

// 正确写法：
if (name !== null && entry.payload.name !== name) continue;

// 当 name = null 时，name !== null 为 false，
// 整个条件为 false，不执行 continue，继续匹配该锚点
```

## LAST_ANCHOR 工作流程

1. 用户初始化 LLM，不传 context
2. TapeManager 检测到 context 为空，创建默认 TapeContext（锚点为 LAST_ANCHOR）
3. 用户创建 Tape session 并调用 `handoff("anchor1")` 打下锚点
4. 用户调用 `chat("消息")`
5. Tape 使用默认 context（LAST_ANCHOR）查询消息
6. `lastAnchor()` 调用 `findAnchorIndex(entries, null, ...)`
7. **修复后**：正确返回锚点索引，查询到锚点后的所有消息
8. 消息被拼接到提示词中，实现多轮对话上下文保持
