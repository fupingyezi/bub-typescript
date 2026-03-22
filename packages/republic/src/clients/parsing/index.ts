import { CompletionTransportParser } from "./completion";
import { ResponseTransportParser } from "./responses";
import { BaseTransportParser, ResponseFormat } from "./types";

/**
 * 解析器映射表
 */
const PARSERS: Record<ResponseFormat, BaseTransportParser> = {
  completion: new CompletionTransportParser(),
  responses: new ResponseTransportParser(),
  messages: new CompletionTransportParser(),
};

/**
 * 根据传输类型获取解析器
 * @param transport 响应格式
 * @returns 传输解析器
 */
export function parserForTransport(
  transport: ResponseFormat,
): BaseTransportParser {
  return PARSERS[transport];
}

export { BaseTransportParser, ResponseFormat };
