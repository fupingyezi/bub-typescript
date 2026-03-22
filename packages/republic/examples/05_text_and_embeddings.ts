import { LLM } from "../src/llm";
import dotenv from "dotenv";

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_BASE = process.env.OPENAI_API_BASE;

if (!OPENAI_API_KEY) {
  console.error("错误：请设置OPENAI_API_KEY环境变量");
  process.exit(1);
}

async function runTextAndEmbeddings() {
  console.log("=== 文本处理与嵌入示例 ===\n");

  const llm = new LLM("openrouter:z-ai/glm-4.5-air:free", {
    apiKey: OPENAI_API_KEY,
    apiBase: OPENAI_API_BASE,
  });

  // 1. if_() 条件检查
  console.log("1. if_() 条件检查...");
  try {
    const result1 = await llm.if_("今天天气真好", "这段文字是否在描述好天气？");
    console.log(`   输入: "今天天气真好"`);
    console.log(`   问题: 这段文字是否在描述好天气？`);
    console.log(`   结果: ${result1}`);
    console.log(`   预期: true\n`);
  } catch (error) {
    console.log(`   错误: ${error}\n`);
  }

  // 2. classify() 文本分类
  console.log("2. classify() 文本分类...");
  try {
    const result2 = await llm.classify(
      "这个产品很好用",
      ["正面评价", "负面评价", "中性评价"]
    );
    console.log(`   输入: "这个产品很好用"`);
    console.log(`   选项: ["正面评价", "负面评价", "中性评价"]`);
    console.log(`   分类结果: ${result2}`);
    console.log(`   预期: 正面评价\n`);
  } catch (error) {
    console.log(`   错误: ${error}\n`);
  }

  // 3. embed() 单个文本嵌入
  console.log("3. embed() 单个文本嵌入...");
  try {
    const singleEmbedding = await llm.embed("Hello world");
    console.log(`   输入: "Hello world"`);
    console.log(`   结果类型: ${typeof singleEmbedding}`);
    if (Array.isArray(singleEmbedding)) {
      console.log(`   嵌入向量长度: ${singleEmbedding.length}`);
      console.log(`   前5个维度: [${singleEmbedding.slice(0, 5).join(", ")}...]`);
    } else if (singleEmbedding && typeof singleEmbedding === 'object') {
      console.log(`   结果结构:`, Object.keys(singleEmbedding));
    }
    console.log();
  } catch (error) {
    console.log(`   错误: ${error}\n`);
  }

  // 4. embed() 多个文本嵌入
  console.log("4. embed() 多个文本嵌入...");
  try {
    const batchEmbedding = await llm.embed(["Hello", "World"]);
    console.log(`   输入: ["Hello", "World"]`);
    console.log(`   结果类型: ${typeof batchEmbedding}`);
    if (Array.isArray(batchEmbedding)) {
      console.log(`   嵌入数组长度: ${batchEmbedding.length}`);
      batchEmbedding.forEach((item, index) => {
        if (Array.isArray(item)) {
          console.log(`   文本${index + 1}向量长度: ${item.length}`);
          console.log(`   文本${index + 1}前5个维度: [${item.slice(0, 5).join(", ")}...]`);
        } else if (item && typeof item === 'object') {
          console.log(`   文本${index + 1}结构:`, Object.keys(item));
        }
      });
    } else if (batchEmbedding && typeof batchEmbedding === 'object') {
      console.log(`   结果结构:`, Object.keys(batchEmbedding));
    }
    console.log();
  } catch (error) {
    console.log(`   错误: ${error}\n`);
  }

  console.log("=== 文本处理与嵌入示例完成 ===");
}

runTextAndEmbeddings().catch((error) => {
  console.error("示例执行出错:", error);
});
