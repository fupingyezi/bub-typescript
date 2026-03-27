import { spawn } from "node:child_process";

/**
 * Shell 命令执行管理器，封装了带超时控制的子进程执行。
 */
export class ShellManager {
  /**
   * 执行 shell 命令，无超时限制。
   * @param command - 要执行的 shell 命令
   * @param cwd - 工作目录，默认为当前目录
   * @returns 包含 stdout、stderr 和 exitCode 的结果对象
   */
  async execute(
    command: string,
    cwd?: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const result = await this.executeWithTimeout(command, 0, cwd);
    return result;
  }

  /**
   * 执行 shell 命令，支持超时控制。
   * 超时后先发送 SIGTERM，1 秒后再发送 SIGKILL。
   * @param command - 要执行的 shell 命令
   * @param timeoutMs - 超时毫秒数，0 表示无超时
   * @param cwd - 工作目录，默认为当前目录
   * @returns 包含 stdout、stderr 和 exitCode 的结果对象
   * @throws 命令启动失败或超时时抛出错误
   */
  async executeWithTimeout(
    command: string,
    timeoutMs: number,
    cwd?: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let killed = false;

      const child = spawn(command, [], {
        shell: true,
        cwd: cwd || undefined,
      });

      child.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("error", (error) => {
        if (!killed) {
          reject(new Error(`Command failed to start: ${error.message}`));
        }
      });

      child.on("close", (code) => {
        if (killed) return;
        const exitCode = code ?? 0;
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode,
        });
      });

      if (timeoutMs > 0) {
        const timer = setTimeout(() => {
          killed = true;
          child.kill("SIGTERM");
          setTimeout(() => {
            if (killed) {
              child.kill("SIGKILL");
            }
          }, 1000);
          reject(
            new Error(`Command timed out after ${timeoutMs}ms: ${command}`),
          );
        }, timeoutMs);

        child.on("close", () => {
          clearTimeout(timer);
        });
      }
    });
  }
}
