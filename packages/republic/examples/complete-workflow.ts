import { LLM } from "../src/llm";
import { TapeContext } from "../src/tape";
import dotenv from "dotenv";

// 加载.env文件中的环境变量
dotenv.config();

// 实际读取环境变量
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error("错误：请设置OPENAI_API_KEY环境变量");
  console.error("提示：可以在.env文件中设置，或通过命令行设置");
  process.exit(1);
}

async function runCompleteWorkflow() {
  console.log("=== 完整LLM工作流示例 ===\n");

  // 1. 初始化LLM - 新的简化方式
  console.log("1. 初始化LLM...");
  const llm = new LLM("openrouter:z-ai/glm-4.5-air:free", {
    maxRetries: 3,
    verbose: 1,
    apiBase: process.env.OPENAI_API_BASE,
  });
  console.log(`✓ LLM初始化成功: ${llm.toString()}\n`);

  // 2. 测试简化的初始化方式（不需要显式指定provider）
  console.log("2. 测试简化的初始化方式...");
  const simpleLlm = new LLM("z-ai/glm-4.5-air:free", {
    apiKey: process.env.OPENAI_API_KEY,
    apiBase: process.env.OPENAI_API_BASE,
    verbose: 1,
  });
  console.log(`✓ 简化LLM初始化成功: ${simpleLlm.toString()}\n`);

  // 2. 创建Tape上下文用于存储会话
  console.log("2. 创建Tape上下文...");
  const context = new TapeContext();
  llm.context = context;
  console.log("✓ Tape上下文创建成功\n");

  // 3. 开始聊天
  console.log("3. 开始聊天...");
  const messages = [
    "你好，我是一个测试用户",
    "你能告诉我一个关于编程的笑话吗？",
    "谢谢，你能解释一下什么是TypeScript吗？",
  ];

  for (const message of messages) {
    console.log(`→ 用户: ${message}`);
    const response = await llm.chat(message);
    console.log(`← LLM: ${response}\n`);
  }

  // 4. 使用Tape存储会话
  console.log("4. 使用Tape存储会话...");
  const tape = llm.tape("test-session");
  console.log("✓ Tape创建成功\n");

  // 5. 测试Tape功能
  console.log("5. 测试Tape功能...");
  // 这里可以添加更多Tape相关的操作，例如存储和检索会话
  console.log("✓ Tape功能测试完成\n");

  console.log("=== 工作流完成 ===");
  console.log("环境变量使用成功！");
}

// 运行工作流
runCompleteWorkflow().catch((error) => {
  console.error("工作流执行出错:", error);
});
