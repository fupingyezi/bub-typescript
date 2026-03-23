import "dotenv/config";
import { LLM } from "../src/llm";
import { Tool } from "../src/tools/schema";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_BASE = process.env.OPENAI_API_BASE;

if (!OPENAI_API_KEY) {
  console.error("错误：请设置OPENAI_API_KEY环境变量");
  process.exit(1);
}

const weatherData: Record<string, string> = {
  北京: "北京今天天气晴朗，气温25°C",
  上海: "上海今天多云转晴，气温28°C",
  广州: "广州今天有雷阵雨，气温30°C",
  深圳: "深圳今天晴天，气温29°C",
};

const getWeatherRunnable = Tool.fromCallable(
  async (args: { city: string }) => {
    const city = args.city || "未知";
    return weatherData[city] || "数据暂不可用";
  },
  {
    name: "get_weather",
    description: "获取指定城市的天气信息",
  },
);

const weatherToolSchema = [
  {
    type: "function" as const,
    function: {
      name: "get_weather",
      description: "获取指定城市的天气信息",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "城市名称" },
        },
        required: ["city"],
      },
    },
  },
];

const weatherToolRunnable = [getWeatherRunnable];

function createLLM(): LLM {
  return new LLM("xunfei:4.0Ultra", {
    apiKey: OPENAI_API_KEY,
    apiBase: OPENAI_API_BASE,
    verbose: 1,
  });
}

async function manualToolMode() {
  console.log("\n========== 手动模式 (Manual Mode) ==========\n");

  const llm = createLLM();

  console.log("步骤1: 调用 llm.toolCalls() 获取工具调用\n");

  try {
    const toolCalls = await llm.toolCalls("北京天气怎么样？", {
      tools: weatherToolSchema,
    });

    console.log("步骤2: 收到工具调用:");
    console.log(JSON.stringify(toolCalls, null, 2));

    if (toolCalls && toolCalls.length > 0) {
      console.log("\n步骤3: 手动执行工具...\n");

      for (const call of toolCalls) {
        const args =
          typeof call.function.arguments === "string"
            ? JSON.parse(call.function.arguments)
            : call.function.arguments;
        const city = args.city || "未知";
        console.log(
          `  城市: ${city}, 天气: ${weatherData[city] || "数据暂不可用"}`,
        );
      }
    } else {
      console.log("未收到工具调用，LLM直接回复了文本");
    }

    console.log("\n========== 手动模式完成 ==========\n");
  } catch (error) {
    console.error("手动模式执行出错:", error);
    throw error;
  }
}

async function autoToolMode() {
  console.log("\n========== 自动模式 (Auto Mode) ==========\n");

  const llm = createLLM();

  console.log("步骤1: 调用 llm.runTools() 自动执行工具\n");

  try {
    const result = await llm.runTools("上海天气怎么样？", {
      tools: weatherToolRunnable,
    });

    console.log("步骤2: 收到执行结果");
    console.log(`  - 结果类型: ${result.kind}`);

    if (result.kind === "text") {
      console.log(`  - 文本内容: ${result.text}`);
    } else if (result.kind === "tools") {
      console.log(`  - 工具调用数量: ${result.toolCalls.length}`);
      console.log(`  - 工具结果数量: ${result.toolResults.length}`);

      for (let i = 0; i < result.toolResults.length; i++) {
        console.log(
          `  - 结果${i + 1}: ${JSON.stringify(result.toolResults[i])}`,
        );
      }
    } else if (result.kind === "error") {
      console.log(`  - 错误: ${result.error}`);
    }

    console.log("\n========== 自动模式完成 ==========\n");
  } catch (error) {
    console.error("自动模式执行出错:", error);
    throw error;
  }
}

async function main() {
  console.log("========================================");
  console.log("  工具调用示例 - Manual vs Auto Mode");
  console.log("========================================");

  try {
    await manualToolMode();
    await autoToolMode();

    console.log("\n示例执行成功！");
    console.log("\n总结:");
    console.log("- 手动模式 (toolCalls): 获取工具调用列表，由开发者自行执行");
    console.log("- 自动模式 (runTools): 自动执行工具并返回结果");
  } catch (error) {
    console.error("示例执行失败:", error);
    process.exit(1);
  }
}

main();
