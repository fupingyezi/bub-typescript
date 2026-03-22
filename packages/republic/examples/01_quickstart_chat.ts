import { LLM } from "../src/llm";
import dotenv from "dotenv";

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_BASE = process.env.OPENAI_API_BASE;

if (!OPENAI_API_KEY) {
  console.error("错误：请设置 OPENAI_API_KEY 环境变量");
  process.exit(1);
}

async function runQuickStart() {
  console.log("=== 快速入门：基础聊天示例 ===\n");

  // 1. 初始化 LLM，使用 openrouter 免费模型
  console.log("1. 初始化 LLM...");
  const llm = new LLM("openrouter:z-ai/glm-4.5-air:free", {
    apiKey: OPENAI_API_KEY,
    apiBase: OPENAI_API_BASE,
  });
  console.log(`✓ LLM 初始化成功: ${llm.toString()}\n`);

  // 2. 单轮对话测试
  console.log("2. 单轮对话测试...");
  const singleResponse = await llm.chat("Hello");
  console.log(`✓ 单轮对话响应: ${singleResponse.substring(0, 100)}...\n`);

  // 3. 多轮对话测试 - 通过连续调用 chat 实现上下文保持
  console.log("3. 多轮对话测试...");
  console.log("   第一轮：询问名字");
  const response1 = await llm.chat("我的名字叫小明，你好！");
  console.log(`   助手回复: ${response1.substring(0, 80)}...`);

  console.log("   第二轮：询问之前的对话内容");
  const response2 = await llm.chat("我刚才告诉你了什么？");
  console.log(`   助手回复: ${response2.substring(0, 80)}...`);
  console.log("✓ 多轮对话测试完成\n");

  // 4. systemPrompt 配置测试
  console.log("4. systemPrompt 配置测试...");
  const systemPromptResponse = await llm.chat("请介绍一下你自己", {
    systemPrompt: "你是一个乐于助人的AI助手，总是用简短友好的方式回答问题。",
  });
  console.log(
    `✓ systemPrompt 测试响应: ${systemPromptResponse.substring(0, 100)}...\n`,
  );

  // 5. 自定义 model 和 provider 测试
  console.log("5. 自定义 model 和 provider 测试...");
  const customLlm = new LLM("openrouter:z-ai/glm-4.5-air:free", {
    apiKey: OPENAI_API_KEY,
    apiBase: OPENAI_API_BASE,
    provider: "openrouter",
  });
  console.log(`✓ 自定义模型 LLM 初始化成功: ${customLlm.toString()}\n`);

  const customResponse = await customLlm.chat("用一句话介绍自己");
  console.log(`✓ 自定义模型响应: ${customResponse.substring(0, 80)}...\n`);

  console.log("=== 快速入门示例完成 ===");
}

runQuickStart().catch(console.error);
