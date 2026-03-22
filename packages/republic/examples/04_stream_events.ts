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

async function basicStreamingDemo() {
  console.log("=== 基本流式输出示例 ===\n");

  const llm = new LLM("openrouter:z-ai/glm-4.5-air:free", {
    apiKey: OPENAI_API_KEY,
    apiBase: OPENAI_API_BASE,
  });

  console.log("1. 使用 stream() 方法获取流式文本...\n");
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

  console.log("\n=== 基本流式输出示例结束 ===\n");
}

async function eventStreamingDemo() {
  console.log("=== 事件流式处理示例 ===\n");

  const llm = new LLM("gpt-3.5-turbo", {
    apiKey: OPENAI_API_KEY,
    apiBase: OPENAI_API_BASE,
  });

  console.log("1. 使用 streamEvents() 方法获取完整事件流...\n");
  console.log("提示词: 你好，请介绍一下自己\n");

  const eventStream = await llm.streamEvents("你好，请介绍一下自己");

  console.log("开始接收事件:");
  console.log("==================");

  let eventCount = 0;
  let textContent = "";
  let toolCalls: any[] = [];
  let toolResults: any[] = [];

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
        if (eventData.name) {
          toolCalls.push(eventData);
        }
        break;

      case "tool_result":
        console.log(`[TOOL_RESULT] 工具结果: ${JSON.stringify(eventData)}`);
        toolResults.push(eventData);
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
  console.log(`工具调用次数: ${toolCalls.length}`);
  console.log(`工具结果次数: ${toolResults.length}`);

  if (eventStream.error) {
    console.log(`流错误: ${eventStream.error}`);
  }
  if (eventStream.usage) {
    console.log(`最终使用量信息: ${JSON.stringify(eventStream.usage)}`);
  }

  console.log("\n=== 事件流式处理示例结束 ===\n");
}

async function eventTypeFilteringDemo() {
  console.log("=== 事件类型过滤示例 ===\n");

  const llm = new LLM("openrouter:z-ai/glm-4.5-air:free", {
    apiKey: OPENAI_API_KEY,
    apiBase: OPENAI_API_BASE,
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
    await basicStreamingDemo();
    await eventStreamingDemo();
    await eventTypeFilteringDemo();

    console.log("所有流式示例执行完成！");
  } catch (error) {
    console.error("示例执行出错:", error);
  }
}

runAllDemos();
