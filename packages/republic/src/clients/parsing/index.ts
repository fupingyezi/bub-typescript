import { CompletionTransportParser } from "./completion";
import { ResponseTransportParser } from "./responses";
import { BaseTransportParser, TransportKind } from "./types";

const PARSERS: Record<TransportKind, BaseTransportParser> = {
  completion: new CompletionTransportParser(),
  responses: new ResponseTransportParser(),
  messages: new CompletionTransportParser(),
};

export function parserForTransport(
  transport: TransportKind,
): BaseTransportParser {
  return PARSERS[transport];
}

export { BaseTransportParser, TransportKind };
