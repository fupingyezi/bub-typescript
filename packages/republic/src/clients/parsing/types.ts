/**
 * 响应格式类型
 */
export type ResponseFormat = "completion" | "responses" | "messages";

/**
 * 传输解析器基类
 */
export abstract class BaseTransportParser {
  /**
   * 判断是否为非流式响应
   * @param response 响应对象
   * @returns 是否为非流式响应
   */
  abstract isNonStreamResponse(response: any): boolean;

  /**
   * 从数据块中提取工具调用增量
   * @param chunk 数据块
   * @returns 工具调用增量数组
   */
  abstract extractChunkToolCallDeltas(chunk: any): any[];

  /**
   * 从数据块中提取文本增量
   * @param chunk 数据块
   * @returns 文本增量
   */
  abstract extractChunkText(chunk: any): string;

  /**
   * 从响应中提取文本
   * @param response 响应对象
   * @returns 文本
   */
  abstract extractText(response: any): string;

  /**
   * 从响应中提取工具调用
   * @param response 响应对象
   * @returns 工具调用数组
   */
  abstract extractToolCalls(response: any): Record<string, any>[];

  /**
   * 从响应中提取使用量信息
   * @param response 响应对象
   * @returns 使用量信息或null
   */
  abstract extractUsage(response: any): Record<string, any> | null;
}
