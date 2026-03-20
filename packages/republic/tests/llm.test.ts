import { LLM } from "../src/llm";
import { TapeContext } from "../src/tape";

describe("LLM", () => {
  describe("constructor", () => {
    it("should create an LLM instance with valid parameters", () => {
      const llm = new LLM("openai:gpt-3.5-turbo");
      expect(llm).toBeInstanceOf(LLM);
      expect(llm.model).toBe("openai:gpt-3.5-turbo");
      expect(llm.provider).toBe("openai");
    });

    it("should throw error when maxRetries < 0", () => {
      expect(() => {
        new LLM("openai:gpt-3.5-turbo", { maxRetries: -1 });
      }).toThrow("maxRetries must be >= 0");
    });

    it("should throw error when verbose is not 0, 1, or 2", () => {
      expect(() => {
        new LLM("openai:gpt-3.5-turbo", { verbose: 3 });
      }).toThrow("verbose must be 0, 1, or 2");

      expect(() => {
        new LLM("openai:gpt-3.5-turbo", { verbose: -1 });
      }).toThrow("verbose must be 0, 1, or 2");
    });

    it("should throw error when apiFormat is invalid", () => {
      expect(() => {
        // @ts-ignore - Testing invalid apiFormat
        new LLM("openai:gpt-3.5-turbo", { apiFormat: "invalid" });
      }).toThrow("apiFormat must be 'completion', 'response', or 'messages'");
    });

    it("should throw error when provider is not specified", () => {
      expect(() => {
        new LLM("gpt-3.5-turbo");
      }).toThrow(
        "Provider must be specified either in the model string or as a separate option",
      );
    });

    it("should create an LLM instance with custom context", () => {
      const context = new TapeContext();
      const llm = new LLM("openai:gpt-3.5-turbo", { context });
      expect(llm.context).toBe(context);
    });
  });

  describe("getters", () => {
    it("should return correct model", () => {
      const llm = new LLM("openai:gpt-3.5-turbo");
      expect(llm.model).toBe("openai:gpt-3.5-turbo");
    });

    it("should return correct provider", () => {
      const llm = new LLM("openai:gpt-3.5-turbo");
      expect(llm.provider).toBe("openai");
    });

    it("should return correct fallbackModels", () => {
      const fallbackModels = ["openai:gpt-4", "openai:gpt-3.5-turbo"];
      const llm = new LLM("openai:gpt-3.5-turbo", { fallbackModels });
      expect(llm.fallbackModels).toEqual(fallbackModels);
    });

    it("should return and set context", () => {
      const llm = new LLM("openai:gpt-3.5-turbo");
      const newContext = new TapeContext();
      llm.context = newContext;
      expect(llm.context).toBe(newContext);
    });
  });

  describe("tape method", () => {
    it("should create a Tape instance", () => {
      const llm = new LLM("openai:gpt-3.5-turbo");
      const tape = llm.tape("test-tape");
      expect(tape).toBeDefined();
    });

    it("should create a Tape instance with custom context", () => {
      const llm = new LLM("openai:gpt-3.5-turbo");
      const context = new TapeContext();
      const tape = llm.tape("test-tape", { context });
      expect(tape).toBeDefined();
    });
  });

  describe("toString method", () => {
    it("should return a string representation of the LLM instance", () => {
      const llm = new LLM("openai:gpt-3.5-turbo", {
        fallbackModels: ["openai:gpt-4"],
        maxRetries: 5,
      });
      const str = llm.toString();
      expect(str).toContain("LLM");
      expect(str).toContain("provider=openai");
      expect(str).toContain("model=openai:gpt-3.5-turbo");
      expect(str).toContain("fallbackModels=openai:gpt-4");
      expect(str).toContain("maxRetries=5");
    });
  });

  describe("unimplemented methods", () => {
    const llm = new LLM("openai:gpt-3.5-turbo");

    it("should throw error for toolCalls", () => {
      expect(() => llm.toolCalls("test prompt")).toThrow(
        "toolCalls is not implemented in ChatClient",
      );
    });

    it("should throw error for toolCallsAsync", async () => {
      await expect(llm.toolCallsAsync("test prompt")).rejects.toThrow(
        "toolCallsAsync is not implemented in ChatClient",
      );
    });

    it("should throw error for runTools", () => {
      expect(() => llm.runTools("test prompt")).toThrow(
        "runTools is not implemented in ChatClient",
      );
    });

    it("should throw error for runToolsAsync", async () => {
      await expect(llm.runToolsAsync("test prompt")).rejects.toThrow(
        "runToolsAsync is not implemented in ChatClient",
      );
    });

    it("should throw error for streamEvents", () => {
      expect(() => llm.streamEvents("test prompt")).toThrow(
        "streamEvents is not implemented in ChatClient",
      );
    });

    it("should throw error for streamEventsAsync", async () => {
      await expect(llm.streamEventsAsync("test prompt")).rejects.toThrow(
        "streamEventsAsync is not implemented in ChatClient",
      );
    });
  });
});
