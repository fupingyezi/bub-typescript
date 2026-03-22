# Checklist - ChatClient 流式传输支持修复

- [x] LLMCore 类有 streamMode getter
- [x] runChat 方法直接使用 this._api_format 决定是否流式传输
- [x] runChat 方法直接使用 this._stream_mode 作为流模式
- [x] LLM 类 options 包含 streamMode 参数
- [x] ChatClient 所有调用 runChat 处已移除 stream/streamMode 参数
- [x] TypeScript 编译通过
