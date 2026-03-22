import { CompletionTransportParser } from "./completion";
import { ResponseTransportParser } from "./responses";
import { BaseTransportParser, ResponseFormat } from "./types";

const PARSERS: Record<ResponseFormat, BaseTransportParser> = {
  completion: new CompletionTransportParser(),
  responses: new ResponseTransportParser(),
  messages: new CompletionTransportParser(),
};

export function parserForTransport(
  transport: ResponseFormat,
): BaseTransportParser {
  return PARSERS[transport];
}

export { BaseTransportParser, ResponseFormat };
