import { LLM } from "../src/llm";
import dotenv from "dotenv";

// 加载.env文件中的环境变量
dotenv.config();

// 实际读取环境变量
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_BASE = process.env.OPENAI_API_BASE;

if (!OPENAI_API_KEY) {
  console.error("错误：请设置OPENAI_API_KEY环境变量");
  console.error("提示：可以在.env文件中设置，或通过命令行设置");
  process.exit(1);
}

async function runSimpleInitialization() {
  console.log("=== 简化LLM初始化示例 ===\n");

  // 1. 最简单的初始化方式 - 只需要model和apiKey
  console.log("1. 最简单的初始化方式...");
  const simpleLlm = new LLM("gpt-3.5-turbo", {
    apiKey: OPENAI_API_KEY,
  });
  console.log(`✓ 简单初始化成功: ${simpleLlm.toString()}\n`);

  // 2. 使用自定义API Base URL
  console.log("2. 使用自定义API Base URL...");
  const customLlm = new LLM("gpt-4", {
    apiKey: OPENAI_API_KEY,
    apiBase: OPENAI_API_BASE,
  });
  console.log(`✓ 自定义URL初始化成功: ${customLlm.toString()}\n`);

  // 3. 从model字符串中自动解析provider
  console.log("3. 从model字符串中自动解析provider...");
  const autoLlm1 = new LLM("openrouter:anthropic/claude-3-haiku", {
    apiKey: OPENAI_API_KEY,
    apiBase: OPENAI_API_BASE,
  });
  console.log(`✓ 自动解析provider成功: ${autoLlm1.toString()}\n`);

  // 4. 使用fallback models
  console.log("4. 使用fallback models...");
  const fallbackLlm = new LLM("gpt-3.5-turbo", {
    apiKey: OPENAI_API_KEY,
    fallbackModels: ["gpt-4", "gpt-3.5-turbo-16k"],
    maxRetries: 2,
  });
  console.log(`✓ Fallback models初始化成功: ${fallbackLlm.toString()}\n`);

  // 5. 测试聊天功能
  console.log("5. 测试聊天功能...");
  try {
    const response = await simpleLlm.chat("你好，请简单介绍一下你自己。");
    console.log(`✓ 聊天测试成功: ${response.substring(0, 100)}...\n`);
  } catch (error) {
    console.log(`⚠ 聊天测试失败: ${error}\n`);
  }

  console.log("=== 简化初始化示例完成 ===");
  console.log(
    "注意：观察控制台输出的provider信息，可以看到系统如何自动解析provider",
  );
}

// 运行示例
runSimpleInitialization().catch((error) => {
  console.error("示例执行出错:", error);
});
