import { LLM } from "../src/llm";
import { LLMCore } from "../src/core/execution";
import { ChatClient } from "../src/clients";
import { TapeContext } from "../src/tape";

// Mock the LLMCore and ChatClient to avoid actual API calls
vi.mock("../src/core/execution", () => ({
  LLMCore: vi.fn().mockImplementation(function () {
    return {
      provider: "openai",
      model: "openai:gpt-3.5-turbo",
      fallback_models: [],
      max_retries: 3,
      maxAttempts: () => 4,
    };
  }),
}));

vi.mock("../src/clients", () => ({
  ChatClient: vi.fn().mockImplementation(function () {
    return {
      create: vi.fn().mockResolvedValue("Hello, world!"),
      stream: vi.fn().mockResolvedValue({
        async *[Symbol.asyncIterator]() {
          yield "Hello, ";
          yield "world!";
        },
      }),
    };
  }),
  TextClient: vi.fn().mockImplementation(function () {
    return {
      if_: vi.fn().mockResolvedValue(true),
      classify: vi.fn().mockResolvedValue("positive"),
    };
  }),
  EmbeddingClient: vi.fn().mockImplementation(function () {
    return {
      embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    };
  }),
}));

describe("LLM Integration Tests", () => {
  let llm: LLM;

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
    // Create a new LLM instance for each test
    llm = new LLM("openai:gpt-3.5-turbo");
  });

  describe("chat functionality", () => {
    it("should return a response from chat", async () => {
      const response = await llm.chat("Hello, how are you?");
      expect(response).toBe("Hello, world!");
    });

    it("should return a response from chatAsync", async () => {
      const response = await llm.chatAsync("Hello, how are you?");
      expect(response).toBe("Hello, world!");
    });
  });

  describe("stream functionality", () => {
    it("should return a stream from stream", async () => {
      const stream = await llm.stream("Hello, how are you?");
      expect(stream).toBeDefined();
    });

    it("should return a stream from streamAsync", async () => {
      const stream = await llm.streamAsync("Hello, how are you?");
      expect(stream).toBeDefined();
    });

    it("should be able to iterate over the stream", async () => {
      const stream = await llm.stream("Hello, how are you?");
      const chunks: string[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual(["Hello, ", "world!"]);
    });
  });

  describe("text functionality", () => {
    it("should return a boolean from if_", async () => {
      const result = await llm.if_("I love this product", "Is this positive?");
      expect(result).toBe(true);
    });

    it("should return a boolean from ifAsync", async () => {
      const result = await llm.ifAsync(
        "I love this product",
        "Is this positive?",
      );
      expect(result).toBe(true);
    });

    it("should return a classification from classify", async () => {
      const result = await llm.classify("I love this product", [
        "positive",
        "negative",
      ]);
      expect(result).toBe("positive");
    });

    it("should return a classification from classifyAsync", async () => {
      const result = await llm.classifyAsync("I love this product", [
        "positive",
        "negative",
      ]);
      expect(result).toBe("positive");
    });
  });

  describe("embedding functionality", () => {
    it("should return embeddings from embed", async () => {
      const result = await llm.embed("Hello, world!");
      expect(result).toEqual([[0.1, 0.2, 0.3]]);
    });

    it("should return embeddings from embedAsync", async () => {
      const result = await llm.embedAsync("Hello, world!");
      expect(result).toEqual([[0.1, 0.2, 0.3]]);
    });

    it("should return embeddings for multiple inputs", async () => {
      const result = await llm.embed(["Hello", "World"]);
      expect(result).toEqual([[0.1, 0.2, 0.3]]);
    });
  });

  describe("tape functionality", () => {
    it("should create a tape instance", () => {
      const tape = llm.tape("test-tape");
      expect(tape).toBeDefined();
    });

    it("should create a tape instance with custom context", () => {
      const context = new TapeContext();
      const tape = llm.tape("test-tape", { context });
      expect(tape).toBeDefined();
    });
  });

  describe("getters and setters", () => {
    it("should return the correct model", () => {
      expect(llm.model).toBe("openai:gpt-3.5-turbo");
    });

    it("should return the correct provider", () => {
      expect(llm.provider).toBe("openai");
    });

    it("should return the correct fallback models", () => {
      expect(llm.fallbackModels).toEqual([]);
    });

    it("should set and get the context", () => {
      const context = new TapeContext();
      llm.context = context;
      expect(llm.context).toBe(context);
    });
  });

  describe("toString method", () => {
    it("should return a string representation of the LLM instance", () => {
      const str = llm.toString();
      expect(str).toContain("LLM");
      expect(str).toContain("provider=openai");
      expect(str).toContain("model=openai:gpt-3.5-turbo");
    });
  });
});
