import { LLM } from '../src/llm';
import { TapeContext } from '../src/tape';
import { LLMCore } from '../src/core/execution';
import { ChatClient } from '../src/clients';

// 模拟LLMCore和ChatClient以避免实际API调用
vi.mock('../src/core/execution', () => ({
  LLMCore: vi.fn().mockImplementation(function () {
    return {
      provider: 'openai',
      model: 'openai:gpt-3.5-turbo',
      fallback_models: [],
      max_retries: 3,
      maxAttempts: () => 4,
    };
  }),
}));

vi.mock('../src/clients', () => ({
  ChatClient: vi.fn().mockImplementation(function () {
    return {
      create: vi.fn().mockResolvedValue('Hello, I am your assistant!'),
      stream: vi.fn().mockResolvedValue({
        async *[Symbol.asyncIterator]() {
          yield 'Hello, ';
          yield 'I am your assistant!';
        },
      }),
    };
  }),
  TextClient: vi.fn().mockImplementation(function () {
    return {
      if_: vi.fn().mockResolvedValue(true),
      classify: vi.fn().mockResolvedValue('positive'),
    };
  }),
  EmbeddingClient: vi.fn().mockImplementation(function () {
    return {
      embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    };
  }),
}));

describe('Complete Workflow Test', () => {
  let llm: LLM;

  beforeEach(() => {
    // 清除所有模拟
    vi.clearAllMocks();
    // 为每个测试创建一个新的LLM实例
    llm = new LLM('openai:gpt-3.5-turbo');
  });

  it('should complete the full workflow successfully', async () => {
    // 1. 初始化LLM
    expect(llm).toBeInstanceOf(LLM);
    expect(llm.model).toBe('openai:gpt-3.5-turbo');
    expect(llm.provider).toBe('openai');

    // 2. 创建Tape上下文
    const context = new TapeContext();
    llm.context = context;
    expect(llm.context).toBe(context);

    // 3. 测试聊天功能
    const response = await llm.chat('Hello, how are you?');
    expect(response).toBe('Hello, I am your assistant!');

    // 4. 测试Tape创建
    const tape = llm.tape('test-session');
    expect(tape).toBeDefined();
  });

  it('should handle multiple chat messages', async () => {
    const messages = [
      'Hello',
      'How are you?',
      'What is TypeScript?'
    ];

    for (const message of messages) {
      const response = await llm.chat(message);
      expect(response).toBe('Hello, I am your assistant!');
    }
  });

  it('should work with custom configuration', async () => {
    const customLlm = new LLM('openai:gpt-3.5-turbo', {
      maxRetries: 5,
      verbose: 2
    });

    expect(customLlm).toBeInstanceOf(LLM);
    const response = await customLlm.chat('Test message');
    expect(response).toBe('Hello, I am your assistant!');
  });
});
