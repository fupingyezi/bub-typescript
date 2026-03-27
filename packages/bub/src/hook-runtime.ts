import {
  BubHooks,
  BubFirstResultHooks,
  BubBroadcastHooks,
  Envelope,
} from "./types";
import { BubPluginManager } from "./plugin-manager";

const SKIP_VALUE = Symbol("SKIP_VALUE");

/**
 * 钉子运行时，负责按插件优先级调用各种钉子方法。
 * 支持“首个有效结果”和“广播所有插件”两种调用模式。
 */
export class HookRuntime {
  constructor(private pm: BubPluginManager) {}

  /**
   * 按插件优先级顺序调用 `BubFirstResultHooks` 中的指定钩子，
   * 返回第一个非 null/undefined 的结果。
   * 若所有插件均未返回有效结果，则返回 `null`。
   * @param hookName - 钩子名称
   * @param args - 传递给钩子函数的参数列表
   * @returns 第一个有效返回值，或 `null`
   */
  async callFirst<T>(
    hookName: keyof BubFirstResultHooks,
    args: any[],
  ): Promise<T | null> {
    const plugins = this.pm.Plugins;

    for (const plugin of plugins) {
      const fn = (plugin.instance as any)[hookName];
      if (!fn) continue;

      try {
        const result = await this.invoke(fn.bind(plugin.instance), args);

        if (result === SKIP_VALUE) continue;
        if (result !== undefined && result !== null) {
          return result as T;
        }
      } catch (err) {
        console.warn(
          `[HookRuntime] Error in ${plugin.name} for ${hookName}:`,
          err,
        );
        continue;
      }
    }
    return null;
  }

  /**
   * 按插件优先级顺序调用 `BubBroadcastHooks` 中的指定钩子，
   * 收集所有插件的返回值（数组会被展开）并返回。
   * @param hookName - 钩子名称
   * @param args - 传递给钩子函数的参数列表
   * @returns 所有插件返回值的聚合数组
   */
  async callMany<T>(
    hookName: keyof BubBroadcastHooks,
    args: any[],
  ): Promise<T[]> {
    const plugins = this.pm.Plugins;
    const results: T[] = [];

    for (const plugin of plugins) {
      const fn = (plugin.instance as any)[hookName];
      if (!fn) continue;

      try {
        const result = await this.invoke(fn.bind(plugin.instance), args);

        if (result === SKIP_VALUE) continue;

        if (result !== undefined && result !== null) {
          if (Array.isArray(result)) {
            results.push(...result);
          } else {
            results.push(result);
          }
        }
      } catch (err) {
        console.warn(
          `[HookRuntime] Error in ${plugin.name} for ${hookName}:`,
          err,
        );
        continue;
      }
    }
    return results;
  }

  /**
   * 与 `callMany` 等价，保留此方法供 `framework.ts` 兼容调用。
   * 动态注册的插件同样可被调用，因为每次都直接遍历 `pm.Plugins`。
   * @param hookName - 钩子名称
   * @param args - 传递给钩子函数的参数列表
   * @returns 所有插件返回值的聚合数组
   */
  async emitBroadcast<T>(
    hookName: keyof BubBroadcastHooks,
    args: any[],
  ): Promise<T[]> {
    return this.callMany<T>(hookName, args);
  }

  /**
   * 向所有实现了 `onError` 钩子的插件广播错误通知。
   * 单个插件的错误处理失败不会中断其他插件的通知。
   * @param stage - 发生错误的处理阶段名称
   * @param error - 错误对象
   * @param message - 触发错误的原始消息信封，可为 `null`
   */
  async notifyError(
    stage: string,
    error: Error,
    message: Envelope | null,
  ): Promise<void> {
    const plugins = this.pm.Plugins;

    for (const plugin of plugins) {
      const fn = (plugin.instance as any)["onError"];
      if (!fn) continue;

      try {
        const result = fn.call(plugin.instance, stage, error, message);
        if (result instanceof Promise) {
          await result.catch((err) => {
            console.warn(
              `[HookRuntime] Observer failed for stage ${stage}:`,
              err,
            );
          });
        }
      } catch (err) {
        console.warn(
          `[HookRuntime] Observer failed for stage ${stage}:`,
          err,
        );
      }
    }
  }

  /**
   * 同步版本的 `callFirst`，按插件优先级顺序调用钩子并返回第一个有效结果。
   * 若钩子函数为异步函数，则跳过并记录警告。
   * @param hookName - 钩子名称
   * @param args - 传递给钩子函数的参数列表
   * @returns 第一个有效返回值，或 `null`
   */
  callFirstSync<T>(hookName: keyof BubFirstResultHooks, args: any[]): T | null {
    const plugins = this.pm.Plugins;

    for (const plugin of plugins) {
      const fn = (plugin.instance as any)[hookName];
      if (!fn) continue;

      try {
        const result = this.invokeSync(
          fn.bind(plugin.instance),
          args,
          plugin.name,
          hookName,
        );

        if (result === SKIP_VALUE) continue;
        if (result !== undefined && result !== null) {
          return result as T;
        }
      } catch (err) {
        console.warn(
          `[HookRuntime] Sync error in ${plugin.name} for ${hookName}:`,
          err,
        );
        continue;
      }
    }
    return null;
  }

  /**
   * 调用函数并等待其结果（支持同步和异步函数）。
   * @param fn - 待调用的函数
   * @param args - 参数列表
   * @returns 函数的返回值（已 await）
   */
  private async invoke(fn: Function, args: any[]): Promise<any> {
    const result = fn(...args);

    if (result instanceof Promise) {
      return await result;
    }

    return result;
  }

  /**
   * 同步调用函数。若函数为异步函数或返回 Promise，则跳过并记录警告。
   * @param fn - 待调用的函数
   * @param args - 参数列表
   * @param pluginName - 插件名称（用于日志）
   * @param hookName - 钩子名称（用于日志）
   * @returns 函数返回值，或 `SKIP_VALUE`（表示跳过）
   */
  private invokeSync(
    fn: Function,
    args: any[],
    pluginName: string,
    hookName: string,
  ): any {
    if (fn.constructor.name === "AsyncFunction") {
      console.warn(
        `[HookRuntime] Async not supported in sync context: ${hookName} in ${pluginName}`,
      );
      return SKIP_VALUE;
    }

    const result = fn(...args);

    if (result instanceof Promise) {
      console.warn(
        `[HookRuntime] Async result returned in sync context: ${hookName} in ${pluginName}`,
      );
      return SKIP_VALUE;
    }

    return result;
  }
}
