# Examples 规范文档

## Why

当前 `packages/republic/examples/` 目录下仅有 2 个基础示例，无法全面展示框架功能。需要创建 5 个示例文件，系统性地测试框架的核心能力，包括聊天、工具调用、Tape 管理、流式事件和文本处理。

## What Changes

- 新增 `01_quickstart_chat.ts` - 快速入门：基础聊天和多轮对话
- 新增 `02_tools_auto_and_manual.ts` - 工具执行：自动工具调用和手动工具执行
- 新增 `03_tape_handoff_and_query.ts` - Tape 管理：Handoff、Query 和上下文切换
- 新增 `04_stream_events.ts` - 流式事件：stream 和 streamEvents 的使用
- 新增 `05_text_and_embeddings.ts` - 文本和嵌入：if_、classify 和 embed 功能

## Impact

- 新增 examples: 5 个示例文件
- 覆盖 LLM 类的核心方法：chat, toolCalls, runTools, stream, streamEvents, embed, if_, classify
- 覆盖 Tape 系统：TapeContext, Tape, TapeManager

## ADDED Requirements

### Requirement: 01_quickstart_chat.ts 示例

该示例应展示框架的基础聊天功能，包括：

1. LLM 初始化（使用环境变量）
2. 简单的单轮对话
3. 多轮对话保持上下文
4. systemPrompt 的使用
5. 自定义 model 和 provider

#### Scenario: 基础聊天功能
- **WHEN** 用户运行示例
- **THEN** 展示单轮对话、多轮对话、systemPrompt 配置

#### Scenario: 环境变量检查
- **WHEN** 未设置 OPENAI_API_KEY
- **THEN** 友好地提示用户设置环境变量并退出

---

### Requirement: 02_tools_auto_and_manual.ts 示例

该示例应展示工具调用的两种模式：

1. **手动模式**：使用 `toolCalls()` 获取工具调用，手动执行
2. **自动模式**：使用 `runTools()` 自动执行工具

#### Scenario: 定义和使用工具
- **WHEN** 定义一个天气查询工具
- **THEN** 展示如何通过 schema 定义工具并调用

#### Scenario: 手动工具执行流程
- **WHEN** 调用 `llm.toolCalls(prompt, { tools })`
- **THEN** 返回工具调用列表，由用户决定如何执行

#### Scenario: 自动工具执行流程
- **WHEN** 调用 `llm.runTools(prompt, { tools })`
- **THEN** 自动执行工具并返回结果

---

### Requirement: 03_tape_handoff_and_query.ts 示例

该示例应展示 Tape 系统的核心功能：

1. 创建 Tape 实例
2. Tape Handoff（在不同上下文间传递）
3. Tape Query（查询历史消息）
4. 多个 Tape 上下文管理

#### Scenario: 创建和使用 Tape
- **WHEN** 调用 `llm.tape("session-name")`
- **THEN** 创建一个可持久化的会话

#### Scenario: Tape Handoff
- **WHEN** 在不同 LLM 实例间传递 Tape
- **THEN** 接收方可以继续该会话

#### Scenario: 查询历史消息
- **WHEN** 使用 tape.entries() 查询历史
- **THEN** 返回该 Tape 的所有条目

---

### Requirement: 04_stream_events.ts 示例

该示例应展示流式输出功能：

1. `stream()` - 基础的文本流
2. `streamEvents()` - 完整的事件流（包含工具调用等）

#### Scenario: 基础流式输出
- **WHEN** 调用 `llm.stream(prompt)`
- **THEN** 返回 AsyncTextStream，可逐步获取文本

#### Scenario: 事件流输出
- **WHEN** 调用 `llm.streamEvents(prompt, { tools })`
- **THEN** 返回 AsyncStreamEvents，包含完整的事件类型

#### Scenario: 事件类型处理
- **WHEN** 遍历 streamEvents
- **THEN** 可以区分 content、toolCall、toolResult 等事件类型

---

### Requirement: 05_text_and_embeddings.ts 示例

该示例应展示文本处理和嵌入功能：

1. `if_()` - 条件判断
2. `classify()` - 文本分类
3. `embed()` - 文本嵌入

#### Scenario: 条件判断
- **WHEN** 调用 `llm.if_(inputText, question)`
- **THEN** 返回 boolean，表示输入是否满足条件

#### Scenario: 文本分类
- **WHEN** 调用 `llm.classify(inputText, choices)`
- **THEN** 返回匹配的分类标签

#### Scenario: 文本嵌入
- **WHEN** 调用 `llm.embed(text)` 或 `llm.embed([text1, text2])`
- **THEN** 返回嵌入向量

---

## 文件结构

```
packages/republic/examples/
├── 01_quickstart_chat.ts       # 基础聊天
├── 02_tools_auto_and_manual.ts # 工具调用
├── 03_tape_handoff_and_query.ts # Tape 管理
├── 04_stream_events.ts         # 流式事件
├── 05_text_and_embeddings.ts   # 文本和嵌入
├── complete-workflow.ts         # (已存在)
└── simple-initialization.ts    # (已存在)
```

## 技术要求

1. 所有示例使用 `dotenv` 加载环境变量
2. 错误处理：API 调用失败时给出友好提示
3. 代码风格：与现有示例保持一致
4. 日志输出：使用 `console.log` 展示执行流程
5. 注释语言：中文（与现有示例一致）
