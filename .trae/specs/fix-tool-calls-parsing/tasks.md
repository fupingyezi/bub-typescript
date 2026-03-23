# Tasks

- [x] Task 1: 分析 _unwrapResponse 对 LangChain AIMessage 的处理
  - [x] SubTask 1.1: 检查 AIMessage 对象的结构
  - [x] SubTask 1.2: 确认 _unwrapResponse 是否正确解包 AIMessage

- [x] Task 2: 检查 extractToolCalls 解析逻辑
  - [x] SubTask 2.1: 验证 completion.ts 的 extractToolCalls 能正确解析响应
  - [x] SubTask 2.2: 添加必要的调试日志

- [x] Task 3: 修复工具调用提取逻辑
  - [x] SubTask 3.1: 修改 _unwrapResponse 以正确处理 AIMessage
  - [x] SubTask 3.2: 修改 extractToolCalls 以支持多种响应格式
  - [x] SubTask 3.3: 修复 runToolsAsync 的错误处理

- [x] Task 4: 验证示例输出
  - [x] SubTask 4.1: 运行 pnpm run example:tools 确认输出正确
  - [x] SubTask 4.2: 确认手动模式返回工具调用列表
  - [x] SubTask 4.3: 确认自动模式自动执行工具并返回结果

# Task Dependencies
- Task 3 依赖 Task 1 和 Task 2 的分析结果
