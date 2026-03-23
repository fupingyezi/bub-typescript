import { LLM } from "../src/llm";
import dotenv from "dotenv";

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_BASE = process.env.OPENAI_API_BASE;

if (!OPENAI_API_KEY) {
  console.error("错误：请设置OPENAI_API_KEY环境变量");
  process.exit(1);
}

const simpleTool = [
  {
    type: "function" as const,
    function: {
      name: "get_time",
      description: "获取当前时间",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

async function streamModeMessagesDemo() {
  console.log("=== 流式模式 messages（默认）===\n");

  const llm = new LLM("xunfei:4.0Ultra", {
    apiKey: OPENAI_API_KEY,
    apiBase: OPENAI_API_BASE,
  });

  console.log("streamMode: 'messages' - 逐块接收 AIMessageChunk 内容\n");
  console.log("提示词: 你好，请给我讲一个关于编程的笑话\n");

  const textStream = await llm.stream("你好，请给我讲一个关于编程的笑话", {
    stream: true,
    streamMode: "messages",
  });

  console.log("开始接收流式内容:");
  console.log("--- 实际内容 ---");

  let fullText = "";
  let chunkCount = 0;

  for await (const chunk of textStream) {
    chunkCount++;
    fullText += chunk;
    process.stdout.write(chunk);
  }

  console.log("\n--- 内容结束 ---");
  console.log(`\n共接收 ${chunkCount} 个文本块`);
  console.log(`完整内容长度: ${fullText.length} 字符\n`);

  if (textStream.error) {
    console.log(`流错误: ${textStream.error}`);
  }
  if (textStream.usage) {
    console.log(`使用量信息: ${JSON.stringify(textStream.usage)}`);
  }

  console.log("\n=== messages 模式示例结束 ===\n");
}

async function streamModeUpdatesDemo() {
  console.log("=== 流式模式 updates ===\n");

  const llm = new LLM("xunfei:4.0Ultra", {
    apiKey: OPENAI_API_KEY,
    apiBase: OPENAI_API_BASE,
  });

  console.log("streamMode: 'updates' - 接收结构化的更新事件\n");
  console.log("提示词: 你好，请介绍一下自己\n");

  const eventStream = await llm.streamEvents("你好，请介绍一下自己", {
    stream: true,
    streamMode: "updates",
  });

  console.log("开始接收事件:");
  console.log("==================");

  let eventCount = 0;
  let textContent = "";

  for await (const event of eventStream) {
    eventCount++;
    const eventKind = event.kind;
    const eventData = event.data;

    switch (eventKind) {
      case "text":
        const delta = eventData.delta || eventData.content || "";
        textContent += delta;
        if (delta) {
          process.stdout.write(`[TEXT] "${delta}"\n`);
        }
        break;

      case "tool_call":
        console.log(`[TOOL_CALL] 工具调用: ${JSON.stringify(eventData)}`);
        break;

      case "tool_result":
        console.log(`[TOOL_RESULT] 工具结果: ${JSON.stringify(eventData)}`);
        break;

      case "usage":
        console.log(`[USAGE] 使用量: ${JSON.stringify(eventData)}`);
        break;

      case "error":
        console.log(`[ERROR] 错误: ${JSON.stringify(eventData)}`);
        break;

      case "final":
        console.log(`[FINAL] 最终完成`);
        break;

      default:
        console.log(`[${eventKind}] ${JSON.stringify(eventData)}`);
    }
  }

  console.log("==================");
  console.log(`\n共处理 ${eventCount} 个事件`);
  console.log(`收集到的文本内容: ${textContent.substring(0, 100)}...`);

  if (eventStream.error) {
    console.log(`流错误: ${eventStream.error}`);
  }
  if (eventStream.usage) {
    console.log(`最终使用量信息: ${JSON.stringify(eventStream.usage)}`);
  }

  console.log("\n=== updates 模式示例结束 ===\n");
}

async function streamModeValuesDemo() {
  console.log("=== 流式模式 values ===\n");

  const llm = new LLM("xunfei:4.0Ultra", {
    apiKey: OPENAI_API_KEY,
    apiBase: OPENAI_API_BASE,
  });

  console.log("streamMode: 'values' - 接收完整的状态值更新\n");
  console.log("提示词: 1+1等于几？\n");

  const eventStream = await llm.streamEvents("1+1等于几？", {
    stream: true,
    streamMode: "values",
  });

  console.log("开始接收事件:");
  console.log("==================");

  let eventCount = 0;
  let textContent = "";

  for await (const event of eventStream) {
    eventCount++;
    const eventKind = event.kind;
    const eventData = event.data;

    switch (eventKind) {
      case "text":
        const delta = eventData.delta || eventData.content || "";
        textContent += delta;
        if (delta) {
          process.stdout.write(`[TEXT] "${delta}"\n`);
        }
        break;

      case "tool_call":
        console.log(`[TOOL_CALL] 工具调用: ${JSON.stringify(eventData)}`);
        break;

      case "tool_result":
        console.log(`[TOOL_RESULT] 工具结果: ${JSON.stringify(eventData)}`);
        break;

      case "usage":
        console.log(`[USAGE] 使用量: ${JSON.stringify(eventData)}`);
        break;

      case "error":
        console.log(`[ERROR] 错误: ${JSON.stringify(eventData)}`);
        break;

      case "final":
        console.log(`[FINAL] 最终完成`);
        break;

      default:
        console.log(`[${eventKind}] ${JSON.stringify(eventData)}`);
    }
  }

  console.log("==================");
  console.log(`\n共处理 ${eventCount} 个事件`);
  console.log(`收集到的文本内容: ${textContent}`);

  if (eventStream.error) {
    console.log(`流错误: ${eventStream.error}`);
  }
  if (eventStream.usage) {
    console.log(`最终使用量信息: ${JSON.stringify(eventStream.usage)}`);
  }

  console.log("\n=== values 模式示例结束 ===\n");
}

async function approachOneInitWithStreamDemo() {
  console.log("=== 方式一：初始化时设置 apiFormat: 'stream' ===\n");

  const llm = new LLM("xunfei:4.0Ultra", {
    apiKey: OPENAI_API_KEY,
    apiBase: OPENAI_API_BASE,
    apiFormat: "stream",
    streamMode: "messages",
  });

  console.log("1. 使用 stream() 方法获取流式文本（继承自初始化配置）...\n");
  console.log("提示词: 你好，请给我讲一个关于编程的笑话\n");

  const textStream = await llm.stream("你好，请给我讲一个关于编程的笑话");

  console.log("开始接收流式内容:");
  console.log("--- 实际内容 ---");

  let fullText = "";
  let chunkCount = 0;

  for await (const chunk of textStream) {
    chunkCount++;
    fullText += chunk;
    process.stdout.write(chunk);
  }

  console.log("\n--- 内容结束 ---");
  console.log(`\n共接收 ${chunkCount} 个文本块`);
  console.log(`完整内容长度: ${fullText.length} 字符\n`);

  if (textStream.error) {
    console.log(`流错误: ${textStream.error}`);
  }
  if (textStream.usage) {
    console.log(`使用量信息: ${JSON.stringify(textStream.usage)}`);
  }

  console.log("\n=== 方式一示例结束 ===\n");
}

async function approachTwoRuntimeStreamParamDemo() {
  console.log("=== 方式二：运行时传入 stream 参数覆盖默认行为 ===\n");

  const llm = new LLM("xunfei:4.0Ultra", {
    apiKey: OPENAI_API_KEY,
    apiBase: OPENAI_API_BASE,
  });

  console.log("1. 使用默认的非流式初始化，但传入 stream: true 参数...\n");
  console.log("提示词: 你好，请给我讲一个关于编程的笑话\n");

  const textStream = await llm.stream("你好，请给我讲一个关于编程的笑话", {
    stream: true,
  });

  console.log("开始接收流式内容:");
  console.log("--- 实际内容 ---");

  let fullText = "";
  let chunkCount = 0;

  for await (const chunk of textStream) {
    chunkCount++;
    fullText += chunk;
    process.stdout.write(chunk);
  }

  console.log("\n--- 内容结束 ---");
  console.log(`\n共接收 ${chunkCount} 个文本块`);
  console.log(`完整内容长度: ${fullText.length} 字符\n`);

  if (textStream.error) {
    console.log(`流错误: ${textStream.error}`);
  }
  if (textStream.usage) {
    console.log(`使用量信息: ${JSON.stringify(textStream.usage)}`);
  }

  console.log("\n=== 方式二示例结束 ===\n");
}

async function eventTypeFilteringDemo() {
  console.log("=== 事件类型过滤示例 ===\n");

  const llm = new LLM("xunfei:4.0Ultra", {
    apiKey: OPENAI_API_KEY,
    apiBase: OPENAI_API_BASE,
    apiFormat: "stream",
  });

  console.log("使用 tools 参数触发工具调用...\n");

  const eventStream = await llm.streamEvents(
    "现在几点了？请用get_time工具获取当前时间",
    { tools: simpleTool },
  );

  console.log("只处理特定类型的事件...\n");

  for await (const event of eventStream) {
    if (event.kind === "text") {
      const content = event.data.delta || event.data.content || "";
      if (content) {
        process.stdout.write(content);
      }
    } else if (event.kind === "tool_call") {
      console.log("\n\n[捕获工具调用]");
      console.log(`工具名称: ${event.data.name}`);
      console.log(`调用参数: ${JSON.stringify(event.data.arguments)}`);
    } else if (event.kind === "tool_result") {
      console.log(`[工具执行结果]: ${JSON.stringify(event.data)}`);
    } else if (event.kind === "final") {
      console.log("\n[流结束]\n");
    }
  }

  console.log("=== 事件类型过滤示例结束 ===\n");
}

async function runAllDemos() {
  try {
    console.log("========================================");
    console.log("三种流式传输模式对比");
    console.log("========================================\n");

    await streamModeMessagesDemo();
    await streamModeUpdatesDemo();
    await streamModeValuesDemo();

    console.log("========================================");
    console.log("初始化方式与参数覆盖示例");
    console.log("========================================\n");

    await approachOneInitWithStreamDemo();
    await approachTwoRuntimeStreamParamDemo();
    await eventTypeFilteringDemo();

    console.log("所有流式示例执行完成！");
    console.log("\n========================================");
    console.log("总结：");
    console.log("========================================");
    console.log("streamMode 三种模式：");
    console.log("  messages - 默认模式，逐块接收 AIMessageChunk 内容");
    console.log("  updates  - 结构化更新事件模式");
    console.log("  values   - 完整状态值更新模式");
    console.log("");
    console.log("流式传输启用方式：");
    console.log("  方式一：初始化 LLM 时设置 apiFormat: 'stream'");
    console.log("  方式二：运行时传入 stream: true 参数覆盖默认行为");
    console.log("  streamMode 参数可在初始化时或运行时指定");
  } catch (error) {
    console.error("示例执行出错:", error);
  }
}

runAllDemos();
