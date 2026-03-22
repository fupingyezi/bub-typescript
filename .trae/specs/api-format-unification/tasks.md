# Tasks

- [x] Task 1: 修改 LLM 构造函数中 apiFormat 类型定义
  - [x] SubTask 1.1: 将 `apiFormat?: "auto" | "completion" | "response" | "messages"` 改为 `apiFormat?: "invoke" | "stream"`
  - [x] SubTask 1.2: 更新默认值从 `"auto"` 改为 `"invoke"`
  - [x] SubTask 1.3: 更新验证逻辑和错误消息

# Task Dependencies
- Task 1 可以独立完成