# Checklist

- [x] ChatClient.toolCallsAsync 方法已实现并能正确提取工具调用
- [x] LLM.toolCalls 方法已实现，不再抛出 "not implemented" 错误
- [x] LLM.toolCallsAsync 方法已实现，不再抛出 "not implemented" 错误
- [x] LLM.runTools 方法已实现，能够自动执行工具并返回 ToolAutoResult
- [x] LLM.runToolsAsync 方法已实现，能够异步自动执行工具并返回 ToolAutoResult
- [x] LLM.streamEvents 方法已实现，返回 AsyncStreamEvents
- [x] LLM.streamEventsAsync 方法已实现，异步返回 AsyncStreamEvents
- [x] 所有新实现的方法都正确处理 context 和 tape 参数
- [x] 类型定义正确，没有 TypeScript 编译错误
