# Tasks

- [x] Task 1: 创建 01_quickstart_chat.ts 示例
  - [x] SubTask 1.1: 检查环境变量 OPENAI_API_KEY
  - [x] SubTask 1.2: 初始化 LLM 实例
  - [x] SubTask 1.3: 实现单轮对话测试
  - [x] SubTask 1.4: 实现多轮对话测试
  - [x] SubTask 1.5: 测试 systemPrompt 配置
  - [x] SubTask 1.6: 测试自定义 model 和 provider

- [x] Task 2: 创建 02_tools_auto_and_manual.ts 示例
  - [x] SubTask 2.1: 定义天气查询工具 schema
  - [x] SubTask 2.2: 实现手动工具调用流程 (toolCalls)
  - [x] SubTask 2.3: 实现自动工具执行流程 (runTools)
  - [x] SubTask 2.4: 展示工具执行结果处理

- [x] Task 3: 创建 03_tape_handoff_and_query.ts 示例
  - [x] SubTask 3.1: 创建 Tape 实例
  - [x] SubTask 3.2: 实现多轮对话并存储到 Tape
  - [x] SubTask 3.3: 实现 Tape Handoff 功能
  - [x] SubTask 3.4: 实现 Tape Query 查询历史
  - [x] SubTask 3.5: 展示 TapeContext 上下文切换

- [x] Task 4: 创建 04_stream_events.ts 示例
  - [x] SubTask 4.1: 实现基础流式输出 (stream)
  - [x] SubTask 4.2: 实现完整事件流 (streamEvents)
  - [x] SubTask 4.3: 处理不同事件类型 (content, toolCall, toolResult)
  - [x] SubTask 4.4: 展示流式输出的实时性

- [x] Task 5: 创建 05_text_and_embeddings.ts 示例
  - [x] SubTask 5.1: 实现条件判断 (if_)
  - [x] SubTask 5.2: 实现文本分类 (classify)
  - [x] SubTask 5.3: 实现单文本嵌入 (embed)
  - [x] SubTask 5.4: 实现多文本批量嵌入
  - [x] SubTask 5.5: 展示嵌入结果结构

# Task Dependencies

- 所有 Task 相互独立，可并行实现
- Task 1 为基础示例，建议首先完成
