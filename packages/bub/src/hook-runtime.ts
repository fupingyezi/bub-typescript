import {
  BubHooks,
  BubFirstResultHooks,
  BubBroadcastHooks,
  Envelope,
} from "./types";
import { BubPluginManager } from "./plugin-manager";

const SKIP_VALUE = Symbol("SKIP_VALUE");

export class HookRuntime {
  constructor(private pm: BubPluginManager) {}

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
   * 与 callMany 等价，保留此方法供 framework.ts 兼容调用。
   * 动态注册的插件同样可被调用，因为每次都直接遍历 pm.Plugins。
   */
  async emitBroadcast<T>(
    hookName: keyof BubBroadcastHooks,
    args: any[],
  ): Promise<T[]> {
    return this.callMany<T>(hookName, args);
  }

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

  private async invoke(fn: Function, args: any[]): Promise<any> {
    const result = fn(...args);

    if (result instanceof Promise) {
      return await result;
    }

    return result;
  }

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
