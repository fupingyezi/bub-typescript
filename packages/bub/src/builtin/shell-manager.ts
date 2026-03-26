import { spawn } from "node:child_process";

export class ShellManager {
  async execute(
    command: string,
    cwd?: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const result = await this.executeWithTimeout(command, 0, cwd);
    return result;
  }

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
