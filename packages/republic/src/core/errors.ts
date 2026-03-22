import { ErrorKindType } from "@/types";

/**
 * Republic错误类
 */
export class RepbulicError extends Error {
  private kind: ErrorKindType;

  /**
   * 构造函数
   * @param kind 错误类型
   * @param message 错误消息
   * @param cause 原始错误
   */
  constructor(kind: ErrorKindType, message: string, cause?: Error | null) {
    super(message, { cause });
    this.kind = kind;
  }

  /**
   * 返回错误字符串表示
   * @returns 错误字符串
   */
  override toString(): string {
    return `${this.kind}: ${this.message}`;
  }

  /**
   * 设置错误原因
   * @param cause 原始错误
   * @returns this
   */
  withCause(cause: Error): RepbulicError {
    this.cause = cause;
    return this;
  }
}
