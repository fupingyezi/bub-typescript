# Tasks

- [x] Task 1: 分析 updates 模式下流处理问题
  - [x] SubTask 1.1: 检查 `_processStreamChunk` 函数在 updates 模式下的行为
  - [x] SubTask 1.2: 检查 LangChain AIMessageChunk 在 updates 模式下的数据结构
  - [x] SubTask 1.3: 确定问题根因

- [x] Task 2: 修复 `_processStreamChunk` 函数
  - [x] SubTask 2.1: 修改 updates 模式的数据提取逻辑
  - [x] SubTask 2.2: 确保正确处理 LangChain AIMessageChunk

- [x] Task 3: 验证修复
  - [x] SubTask 3.1: 运行示例验证三种模式都正常工作
  - [x] SubTask 3.2: 确保 messages 模式不被破坏
  - [x] SubTask 3.3: 确保 values 模式不被破坏

# Task Dependencies
- Task 2 依赖于 Task 1 的分析结果
- Task 3 依赖于 Task 2 完成
