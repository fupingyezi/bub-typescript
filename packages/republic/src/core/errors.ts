import { ErrorKindType } from "@/types";

export class RepbulicError extends Error {
  private kind: ErrorKindType;

  constructor(kind: ErrorKindType, message: string, cause?: Error | null) {
    super(message, { cause });
    this.kind = kind;
  }

  override toString(): string {
    return `${this.kind}: ${this.message}`;
  }

  withCause(cause: Error): RepbulicError {
    this.cause = cause;
    return this;
  }
}
