import { LLM } from "../src/llm";
import { TapeContext } from "../src/tape";
import dotenv from "dotenv";

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_BASE = process.env.OPENAI_API_BASE;

if (!OPENAI_API_KEY) {
  console.error("请设置 OPENAI_API_KEY 环境变量");
  process.exit(1);
}

async function runTapeDemo() {
  console.log("=== Tape Handoff 和 Query 示例 ===\n");

  const llm = new LLM("openrouter:z-ai/glm-4.5-air:free", {
    apiKey: OPENAI_API_KEY,
    apiBase: OPENAI_API_BASE,
    verbose: 1,
  });
  console.log(`LLM 初始化: ${llm.toString()}\n`);

  console.log("1. 创建 Tape 实例");
  const tape = llm.tape("my-session");
  console.log(`Tape 创建成功: ${tape.toString()}\n`);

  console.log("2. 多轮对话存储到 Tape");
  console.log("--- 第一轮对话 ---");
  let response = await tape.chat("你好，我是用户A");
  console.log(`用户: 你好，我是用户A`);
  console.log(`LLM: ${response}\n`);

  console.log("--- 第二轮对话 ---");
  response = await tape.chat("请给我讲个笑话");
  console.log(`用户: 请给我讲个笑话`);
  console.log(`LLM: ${response}\n`);

  console.log("--- 第三轮对话 ---");
  response = await tape.chat("太好笑了，谢谢");
  console.log(`用户: 太好笑了，谢谢`);
  console.log(`LLM: ${response}\n`);

  console.log("3. 查询 Tape 历史记录");
  const query = tape.query;
  const entries = query.all();
  console.log(`共 ${entries.length} 条记录:`);
  for (const entry of entries) {
    if (entry.kind === "message") {
      const msg = entry.payload;
      console.log(`  [${entry.kind}] ${msg.role}: ${msg.content?.substring(0, 50)}...`);
    } else {
      console.log(`  [${entry.kind}]`);
    }
  }
  console.log();

  console.log("4. Tape Handoff - 交接给另一个 LLM");
  const handoffEntries = tape.handoff("handoff-to-b", { user: "用户B" }, { reason: "演示交接" });
  console.log(`创建交接锚点: ${handoffEntries[0].payload.name}`);
  console.log(`交接状态: ${JSON.stringify(handoffEntries[0].payload.state)}`);

  const llm2 = new LLM("openrouter:z-ai/glm-4.5-air:free", {
    apiKey: OPENAI_API_KEY,
    apiBase: OPENAI_API_BASE,
    verbose: 1,
  });
  console.log(`第二个 LLM 初始化: ${llm2.toString()}`);

  const tape2 = llm2.tape("my-session");
  console.log(`使用同一个 tape 名称 "my-session" 继续对话\n`);

  console.log("--- 第四轮对话 (由 LLM2 继续) ---");
  response = await tape2.chat("请继续讲另一个笑话");
  console.log(`用户: 请继续讲另一个笑话`);
  console.log(`LLM: ${response}\n`);

  console.log("5. TapeContext 用法演示");
  const lastContext = new TapeContext();
  const messagesWithLastContext = tape.readMessages(lastContext);
  console.log(`使用 LAST_ANCHOR 上下文的消息数: ${messagesWithLastContext.length}`);

  const afterAnchorContext = new TapeContext("handoff-to-b");
  const messagesAfterHandoff = tape2.readMessages(afterAnchorContext);
  console.log(`使用 "handoff-to-b" 锚点后的消息数: ${messagesAfterHandoff.length}`);

  console.log("\n=== Tape 示例完成 ===");
}

runTapeDemo().catch(console.error);
