# 需求文档：bub-typescript 完善与 Bug 修复

## 引言

`bub-typescript` 是 bub AI 框架的 TypeScript 实现，基于 `republic` 包提供的 LLM 基础设施，构建了一个插件化、hook 驱动的 AI Agent 框架。通过对当前代码库的全面分析，发现了多处 Bug、不完整实现（TODO 占位符）以及设计不一致问题，需要系统性地修复和完善。

本文档将问题分为以下几类：
1. **明确的 Bug**：代码逻辑错误，会导致运行时崩溃或行为异常
2. **不完整实现**：TODO 占位符，核心功能缺失
3. **设计不一致**：接口或实现与预期行为不符

---

## 需求

### 需求 1：修复类型和 API 调用错误

**用户故事：** 作为一名框架使用者，我希望框架的核心代码没有明显的类型错误和 API 调用错误，以便代码能够正确运行而不会在运行时崩溃。

#### 验收标准

1. WHEN `BuiltinImpl._readAgentsFile` 被调用 THEN 系统 SHALL 使用 `state['_runtime_workspace']` 而非 `state.get('_runtime_workspace')`（`State` 是 `Record<string, any>` 类型，没有 `.get()` 方法）
2. WHEN `builtin/context.ts` 中的 `_appendToolCallEntry` 和 `_appendToolResultEntry` 被调用 THEN 系统 SHALL 使用 `payload.calls`、`payload.results` 等属性访问方式，而非 `payload.get('calls')` 等 Map 方法（`TapeEntry.payload` 是普通 JS 对象）
3. WHEN `builtin/context.ts` 中的 `_buildToolResultMessage` 被调用 THEN 系统 SHALL 使用 `call.id`、`call.function` 等属性访问，而非 `call.get('id')`
4. WHEN `ChannelMessage` 被构造 THEN 系统 SHALL 将 `chatId` 默认值从 `"defualt"` 修正为 `"default"`
5. WHEN `CliChannel` 创建 `ChannelMessage` 时 THEN 系统 SHALL 按照正确的参数顺序 `(sessionId, channel, content, chatId)` 传参，而非当前错误的 `(sessionId, channel, chatId, content)` 顺序
6. WHEN `BUB_HOOK_NAMES` 被定义 THEN 系统 SHALL 移除重复的 `dispatchOutbound` 条目（当前在 `types.ts` 中出现了两次）

### 需求 2：修复 `builtin/settings.ts` 中的 HOME 路径问题

**用户故事：** 作为一名框架使用者，我希望 Agent 的 home 目录能够正确解析到用户主目录下的 `.bub` 文件夹，以便配置和数据能够正确存储。

#### 验收标准

1. WHEN `AgentSettingsImpl` 被实例化 THEN 系统 SHALL 将 `DEFAULT_HOME` 从 `new URL("file://~/.bub").pathname`（无法正确展开 `~`）改为使用 `path.join(os.homedir(), '.bub')` 来正确获取用户主目录路径
2. IF `BUB_HOME` 环境变量被设置 THEN 系统 SHALL 优先使用该环境变量作为 home 目录

### 需求 3：修复 `builtin/tape.ts` 中的异步处理问题

**用户故事：** 作为一名框架使用者，我希望 tape 相关操作能够正确处理异步数据，以便 tape 的查询和信息获取功能正常工作。

#### 验收标准

1. WHEN `TapeService.info()` 被调用 THEN 系统 SHALL 正确 await `tape.queryAsync.all()` 返回的 Promise，而非对 Promise 对象调用 `Array.from()`（当前 `list()` 函数无法正确处理 Promise）
2. WHEN `TapeService.anchors()` 被调用 THEN 系统 SHALL 正确处理异步查询结果，使用 `entry.payload.name` 而非 `entry.payload.get('name')`
3. WHEN `TapeService.sessionTape()` 计算 tape 名称 THEN 系统 SHALL 使用 Node.js 内置的 `crypto.createHash('md5')` 替代当前不正确的自定义 hash 实现，确保生成的 tape 名称具有足够的唯一性和一致性

### 需求 4：完善 `FileTapeStore` 的文件 I/O 实现

**用户故事：** 作为一名框架使用者，我希望 tape 数据能够持久化到磁盘，以便在会话重启后能够恢复历史对话记录。

#### 验收标准

1. WHEN `FileTapeStore.append()` 被调用 THEN 系统 SHALL 将 tape 条目以 JSONL 格式追加写入到对应的文件中
2. WHEN `FileTapeStore.fetchAll()` 被调用 THEN 系统 SHALL 从磁盘文件中读取并解析 JSONL 格式的 tape 条目
3. WHEN `FileTapeStore.reset()` 被调用 THEN 系统 SHALL 删除对应的 tape 文件
4. WHEN `FileTapeStore.listTapes()` 被调用 THEN 系统 SHALL 扫描目录并返回所有 tape 文件名（不含扩展名）
5. IF tape 文件所在目录不存在 THEN 系统 SHALL 自动创建该目录
6. WHEN `TapeFile` 读取文件时 THEN 系统 SHALL 支持增量读取（只读取新增的行），避免重复读取已缓存的内容

### 需求 5：完善 `ForkTapeStore` 的 fork 作用域实现

**用户故事：** 作为一名框架使用者，我希望 Agent 在处理每个请求时能够使用独立的 tape 分支，以便在请求完成后可以选择性地将数据合并回主存储。

#### 验收标准

1. WHEN `ForkTapeStore.fork()` 被调用 THEN 系统 SHALL 创建一个新的 `InMemoryTapeStore` 作为当前请求的临时存储
2. WHEN fork 作用域内有 `append` 操作 THEN 系统 SHALL 将数据写入临时存储而非父存储
3. WHEN `mergeBack` 为 `true` 且 fork 作用域结束 THEN 系统 SHALL 将临时存储中的所有条目合并回父存储
4. WHEN `mergeBack` 为 `false` 且 fork 作用域结束 THEN 系统 SHALL 丢弃临时存储中的数据

### 需求 6：完善内置工具实现

**用户故事：** 作为一名 Agent 使用者，我希望内置工具（文件操作、网络请求、子 Agent 等）能够正常工作，以便 Agent 能够完成实际任务。

#### 验收标准

1. WHEN `fs.read` 工具被调用 THEN 系统 SHALL 读取指定路径的文件内容，支持 `offset` 和 `limit` 参数进行分页读取，并在路径为相对路径时基于 workspace 解析
2. WHEN `fs.write` 工具被调用 THEN 系统 SHALL 将内容写入指定路径的文件，如目录不存在则自动创建
3. WHEN `fs.edit` 工具被调用 THEN 系统 SHALL 在文件中查找 `oldStr` 并替换为 `newStr`，如果找不到则返回错误信息
4. WHEN `web.fetch` 工具被调用 THEN 系统 SHALL 发起 HTTP GET 请求，支持自定义 headers 和超时设置，返回响应内容
5. WHEN `tape.search` 工具被调用 THEN 系统 SHALL 在当前 tape 中搜索匹配的条目，支持按关键词、时间范围和条目类型过滤
6. WHEN `subagent` 工具被调用 THEN 系统 SHALL 创建一个子 Agent 实例并执行给定的 prompt，支持指定模型、允许的工具和技能

### 需求 7：完善 CLI 命令实现

**用户故事：** 作为一名开发者，我希望能够通过命令行与 bub Agent 交互，以便进行开发调试和日常使用。

#### 验收标准

1. WHEN `bub run --message "..."` 命令被执行 THEN 系统 SHALL 创建一个 `ChannelMessage` 并调用 `framework.processInbound()` 处理，输出结果到控制台
2. WHEN `bub chat` 命令被执行 THEN 系统 SHALL 启动 `ChannelManager` 并激活 CLI channel，进入交互式对话模式
3. WHEN `bub gateway` 命令被执行 THEN 系统 SHALL 启动 `ChannelManager` 并激活所有配置的 channel（如 Telegram）
4. WHEN `bub hooks` 命令被执行 THEN 系统 SHALL 输出当前已注册的所有 hook 实现列表

### 需求 8：完善 `Agent._systemPrompt` 和工具提示词渲染

**用户故事：** 作为一名 Agent 使用者，我希望 Agent 在调用 LLM 时能够提供完整的系统提示词（包括工具列表和技能列表），以便 LLM 能够正确使用可用的工具和技能。

#### 验收标准

1. WHEN `Agent._systemPrompt()` 被调用 THEN 系统 SHALL 异步获取 framework 的系统提示词（`getSystemPrompt` 是异步方法）
2. WHEN 工具提示词被渲染 THEN 系统 SHALL 使用 `renderToolsPrompt()` 函数将可用工具列表格式化为 `<available_tools>` XML 块
3. WHEN 技能提示词被渲染 THEN 系统 SHALL 使用 `discoverSkills()` 和 `renderSkillsPrompt()` 函数将可用技能列表格式化为 `<available_skills>` XML 块
4. WHEN `allowedSkills` 参数被指定 THEN 系统 SHALL 只展示允许的技能子集

### 需求 9：修复 `Agent._runToolsOnce` 中的工具调用集成

**用户故事：** 作为一名 Agent 使用者，我希望 Agent 能够正确调用 LLM 并执行工具，以便完成需要多步骤工具调用的任务。

#### 验收标准

1. WHEN `Agent._runToolsOnce()` 被调用 THEN 系统 SHALL 将 `REGISTRY` 中的工具转换为 republic 的 `Tool` 格式并传递给 `tape.runToolsAsync()`
2. WHEN `tape.runToolsAsync()` 被调用 THEN 系统 SHALL 传入正确格式的 `tools` 参数（`ToolInput` 类型）
3. WHEN `_systemPrompt` 被调用 THEN 系统 SHALL 正确 await 异步结果

### 需求 10：修复 `HookRuntime` 插件注册一致性问题

**用户故事：** 作为一名框架开发者，我希望动态注册的插件能够正确参与 hook 调用，以便插件系统能够正常工作。

#### 验收标准

1. WHEN 新插件通过 `BubPluginManager.register()` 注册后 THEN 系统 SHALL 确保 `HookRuntime` 的 `callMany` 和 `callFirst` 方法能够调用到新插件的 hook 实现（当前 `registerPlugins()` 只在构造时调用一次，后续注册的插件不会被 EventEmitter 监听）
2. WHEN `emitBroadcast` 和 `callMany` 都用于广播 hook 时 THEN 系统 SHALL 统一使用 `callMany` 方式（直接遍历插件列表），移除冗余的 `emitBroadcast` 方法，消除双重实现的不一致性

### 需求 11：完善 `ChannelManager` 的异步初始化

**用户故事：** 作为一名框架使用者，我希望 `ChannelManager` 能够正确初始化所有 channel，以便消息能够正确路由。

#### 验收标准

1. WHEN `ChannelManager` 被构造 THEN 系统 SHALL 使用异步初始化方式获取 channels（`framework.getChannels()` 返回 `Promise`，不能在构造函数中同步调用）
2. WHEN `ChannelManager.listenAndRun()` 被调用 THEN 系统 SHALL 在开始监听前确保所有 channels 已完成初始化
