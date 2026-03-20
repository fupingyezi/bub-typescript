# 完整LLM工作流示例

这个示例展示了如何使用Republic包创建一个完整的LLM工作流，包括初始化LLM、聊天、存储会话等功能。

## 目录结构

```
examples/
├── complete-workflow.ts     # 完整工作流示例
└── README.md                # 本说明文件
```

## 环境配置

在运行示例之前，你需要配置以下环境变量：

### 方法1：创建.env文件

在项目根目录创建一个 `.env` 文件，内容如下：

```env
# OpenAI API密钥
OPENAI_API_KEY=your-api-key-here

# OpenAI API基础URL（可选）
OPENAI_API_BASE=https://api.openai.com/v1

# 可选：其他提供商的API密钥
# ANTHROPIC_API_KEY=your-anthropic-api-key
# GOOGLE_API_KEY=your-google-api-key
```

### 方法2：直接设置环境变量

在运行命令前，直接设置环境变量：

#### Windows

```powershell
$env:OPENAI_API_KEY="your-api-key-here"
$env:OPENAI_API_BASE="https://api.openai.com/v1"
```

#### Linux/macOS

```bash
export OPENAI_API_KEY="your-api-key-here"
export OPENAI_API_BASE="https://api.openai.com/v1"
```

## 运行示例

### 1. 安装依赖

确保你已经安装了项目依赖：

```bash
pnpm install
```

### 2. 编译项目

```bash
pnpm build
```

### 3. 运行示例

```bash
# 运行完整工作流示例
pnpm example
```

## 示例功能说明

1. **初始化LLM**：创建一个LLM实例，配置模型和参数
2. **创建Tape上下文**：用于存储会话数据
3. **聊天功能**：发送消息并获取LLM的回复
4. **Tape存储**：使用Tape存储会话数据

## 注意事项

- 确保你有有效的API密钥
- 示例中使用的是OpenAI的模型，你可以根据需要修改为其他提供商的模型
- `OPENAI_API_BASE` 是可选的，如果不设置将使用默认的OpenAI API地址
- 测试文件已移至 `tests/complete-workflow.test.ts` 目录
