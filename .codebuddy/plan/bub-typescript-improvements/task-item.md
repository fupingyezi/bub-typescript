# 实施计划

- [ ] 1. 修复核心类型和 API 调用 Bug
   - 修复 `builtin/hook-impl.ts` 中 `state.get()` → `state['key']` 属性访问
   - 修复 `builtin/context.ts` 中所有 `payload.get()` / `call.get()` → 属性访问
   - 修复 `channels/message.ts` 中 `chatId` 默认值拼写：`"defualt"` → `"default"`
   - 修复 `channels/cli/index.ts` 中 `ChannelMessage` 构造参数顺序错误
   - 修复 `types.ts` 中 `BUB_HOOK_NAMES` 重复的 `dispatchOutbound` 条目
   - _需求：1.1、1.2、1.3、1.4、1.5、1.6_

- [ ] 2. 修复 settings、tape 中的路径和异步问题
   - 修复 `builtin/settings.ts` 中 `DEFAULT_HOME` 使用 `path.join(os.homedir(), '.bub')` 替代 `new URL("file://~/.bub").pathname`
   - 修复 `builtin/tape.ts` 中 `list()` 函数正确 await 异步查询结果
   - 修复 `builtin/tape.ts` 中 `anchors()` 使用 `entry.payload.name` 替代 `entry.payload.get('name')`
   - 修复 `builtin/tape.ts` 中 `sessionTape()` 使用 `crypto.createHash('md5')` 替代自定义 hash
   - _需求：2.1、2.2、3.1、3.2、3.3_

- [ ] 3. 实现 `FileTapeStore` 文件 I/O
   - 实现 `append()` 以 JSONL 格式追加写入磁盘
   - 实现 `fetchAll()` 从磁盘读取并解析 JSONL 条目
   - 实现 `reset()` 删除对应 tape 文件
   - 实现 `listTapes()` 扫描目录返回所有 tape 名称
   - 实现目录不存在时自动创建
   - 实现 `TapeFile` 增量读取（只读新增行）
   - _需求：4.1、4.2、4.3、4.4、4.5、4.6_

- [ ] 4. 实现 `ForkTapeStore` fork 作用域
   - 实现 `fork()` 创建 `InMemoryTapeStore` 作为临时存储
   - 实现 fork 作用域内 `append` 写入临时存储
   - 实现 `mergeBack=true` 时将临时存储合并回父存储
   - 实现 `mergeBack=false` 时丢弃临时存储数据
   - _需求：5.1、5.2、5.3、5.4_

- [ ] 5. 实现内置文件系统和网络工具
   - 实现 `fs.read` 工具：读取文件内容，支持 `offset`/`limit` 分页，相对路径基于 workspace 解析
   - 实现 `fs.write` 工具：写入文件，自动创建目录
   - 实现 `fs.edit` 工具：查找 `oldStr` 替换为 `newStr`，找不到时返回错误
   - 实现 `web.fetch` 工具：HTTP GET 请求，支持自定义 headers 和超时
   - _需求：6.1、6.2、6.3、6.4_

- [ ] 6. 实现 `tape.search` 和 `subagent` 工具
   - 实现 `tape.search` 工具：按关键词、时间范围、条目类型过滤搜索 tape 条目
   - 实现 `subagent` 工具：创建子 Agent 实例执行 prompt，支持指定模型、工具和技能
   - _需求：6.5、6.6_

- [ ] 7. 完善 `Agent._systemPrompt` 和 `_runToolsOnce`
   - 修复 `_systemPrompt()` 正确 await 异步 `getSystemPrompt()`
   - 实现工具提示词渲染：使用 `renderToolsPrompt()` 生成 `<available_tools>` XML 块
   - 实现技能提示词渲染：使用 `discoverSkills()` 和 `renderSkillsPrompt()` 生成 `<available_skills>` XML 块
   - 修复 `_runToolsOnce()` 将 `REGISTRY` 工具转换为 republic `Tool` 格式传入 `tape.runToolsAsync()`
   - _需求：8.1、8.2、8.3、8.4、9.1、9.2、9.3_

- [ ] 8. 修复 `HookRuntime` 插件注册一致性和 `ChannelManager` 异步初始化
   - 修复 `HookRuntime`：动态注册插件后同步更新监听，确保 `callMany`/`callFirst` 能调用新插件
   - 统一广播实现：移除冗余的 `emitBroadcast`，统一使用 `callMany` 遍历插件列表
   - 修复 `ChannelManager` 构造函数：改为异步初始化，`listenAndRun()` 前确保 channels 已就绪
   - _需求：10.1、10.2、11.1、11.2_

- [ ] 9. 实现 CLI 命令
   - 实现 `bub run --message "..."` 命令：创建 `ChannelMessage` 并调用 `framework.processInbound()` 处理
   - 实现 `bub chat` 命令：启动 `ChannelManager` 并激活 CLI channel 进入交互模式
   - 实现 `bub gateway` 命令：启动 `ChannelManager` 并激活所有配置的 channel
   - 实现 `bub hooks` 命令：输出当前已注册的所有 hook 实现列表
   - _需求：7.1、7.2、7.3、7.4_
