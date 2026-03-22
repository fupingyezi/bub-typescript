# Tasks

- [x] Task 1: 实现 ChatClient.toolCallsAsync 方法
  - [x] SubTask 1.1: 在 ChatClient 中添加 toolCallsAsync 方法
  - [x] SubTask 1.2: 实现从响应中提取工具调用的逻辑
  - [x] SubTask 1.3: 更新 tape 记录

- [x] Task 2: 实现 LLM.toolCalls 方法
  - [x] SubTask 2.1: 实现同步 toolCalls 方法，调用 _chatClient.create 并提取工具调用
  - [x] SubTask 2.2: 移除 "not implemented" 错误

- [x] Task 3: 实现 LLM.toolCallsAsync 方法
  - [x] SubTask 3.1: 实现异步 toolCallsAsync 方法，调用 _chatClient.toolCallsAsync
  - [x] SubTask 3.2: 移除 "not implemented" 错误

- [x] Task 4: 实现 LLM.runTools 方法
  - [x] SubTask 4.1: 实现同步 runTools 方法
  - [x] SubTask 4.2: 集成 ToolExecutor 执行工具
  - [x] SubTask 4.3: 返回 ToolAutoResult

- [x] Task 5: 实现 LLM.runToolsAsync 方法
  - [x] SubTask 5.1: 实现异步 runToolsAsync 方法
  - [x] SubTask 5.2: 使用异步工具执行
  - [x] SubTask 5.3: 返回 Promise<ToolAutoResult>

- [x] Task 6: 实现 LLM.streamEvents 方法
  - [x] SubTask 6.1: 实现 streamEvents 方法
  - [x] SubTask 6.2: 返回 AsyncStreamEvents 对象

- [x] Task 7: 实现 LLM.streamEventsAsync 方法
  - [x] SubTask 7.1: 实现异步 streamEventsAsync 方法
  - [x] SubTask 7.2: 返回 Promise<AsyncStreamEvents>

# Task Dependencies
- Task 2, 3 依赖 Task 1（ChatClient 需要先有 toolCallsAsync）
- Task 4, 5 依赖 Task 2, 3（runTools 需要先有 toolCalls）
- Task 6, 7 可以独立实现（基于现有的 stream 能力）
