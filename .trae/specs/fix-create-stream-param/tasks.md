# Tasks - ChatClient 流式传输支持修复

- [x] Task 1: 在 LLMCore 类添加 streamMode 属性和 getter
  - [x] SubTask 1.1: 添加 `private _stream_mode: StreamMode` 属性
  - [x] SubTask 1.2: 在构造函数中添加 `stream_mode: StreamMode` 参数
  - [x] SubTask 1.3: 添加 `get streamMode()` 方法

- [x] Task 2: 修改 runChat 方法直接使用实例属性
  - [x] SubTask 2.1: 移除 `stream` 和 `streamMode` 参数
  - [x] SubTask 2.2: 使用 `this._api_format === "stream"` 决定是否流式
  - [x] SubTask 2.3: 使用 `this._stream_mode` 作为流模式

- [x] Task 3: 在 LLM 类添加 streamMode 选项
  - [x] SubTask 3.1: 在 options 类型中添加 `streamMode`
  - [x] SubTask 3.2: 从 options 中解构 `streamMode`，默认值为 `"messages"`
  - [x] SubTask 3.3: 将 `streamMode` 传递给 `new LLMCore`

- [x] Task 4: 更新 ChatClient 调用处移除 stream/streamMode 参数
  - [x] SubTask 4.1: 更新 `create` 方法中的调用
  - [x] SubTask 4.2: 更新 `toolCallsAsync` 方法中的调用
  - [x] SubTask 4.3: 更新 `stream` 方法中的调用
  - [x] SubTask 4.4: 更新 `streamEventsAsync` 方法中的调用

- [x] Task 5: 运行 TypeScript 编译验证
