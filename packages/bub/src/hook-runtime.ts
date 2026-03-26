import EventEmitter from "node:events";
import {
  BubHooks,
  BubFirstResultHooks,
  BubBroadcastHooks,
  PluginMeta,
  Envelope,
} from "./types";
import { BubPluginManager } from "./plugin-manager";

const SKIP_VALUE = Symbol("SKIP_VALUE");

export class HookRuntime {
  private emitter = new EventEmitter();

  constructor(private pm: BubPluginManager) {
    this.emitter.setMaxListeners(100);
    this.registerPlugins();
  }

  private registerPlugins() {
    for (const plugin of this.pm.Plugins) {
      const instance = plugin.instance as BubHooks;
      if (instance.saveState) {
        this.emitter.on("saveState", instance.saveState.bind(instance));
      }
      if (instance.renderOutbound) {
        this.emitter.on(
          "renderOutbound",
          instance.renderOutbound.bind(instance),
        );
      }
      if (instance.dispatchOutbound) {
        this.emitter.on(
          "dispatchOutbound",
          instance.dispatchOutbound.bind(instance),
        );
      }
      if (instance.registerCliCommands) {
        this.emitter.on(
          "registerCliCommands",
          instance.registerCliCommands.bind(instance),
        );
      }
      if (instance.onError) {
        this.emitter.on("onError", instance.onError.bind(instance));
      }
      if (instance.systemPrompt) {
        this.emitter.on("systemPrompt", instance.systemPrompt.bind(instance));
      }
      if (instance.provideChannels) {
        this.emitter.on(
          "provideChannels",
          instance.provideChannels.bind(instance),
        );
      }
    }
  }

  async callFirst<T>(
    hookName: keyof BubFirstResultHooks,
    args: any[],
  ): Promise<T | null> {
    const plugins = this.pm.Plugins;

    for (const plugin of plugins) {
      const fn = (plugin.instance as any)[hookName];
      if (!fn) continue;

      try {
        const result = await this.invoke(fn, args);

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
        const result = await this.invoke(fn, args);

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

  async emitBroadcast<T>(
    hookName: keyof BubBroadcastHooks,
    args: any[],
  ): Promise<T[]> {
    return new Promise((resolve) => {
      const results: T[] = [];
      const listeners = this.emitter.listeners(hookName as string);

      if (listeners.length === 0) {
        resolve([]);
        return;
      }

      let pending = listeners.length;

      for (const listener of listeners) {
        const result = (listener as Function)(...args);

        if (result instanceof Promise) {
          result
            .then((value) => {
              if (value !== undefined && value !== null) {
                if (Array.isArray(value)) {
                  results.push(...(value as any));
                } else {
                  results.push(value as any);
                }
              }
            })
            .finally(() => {
              pending--;
              if (pending === 0) {
                resolve(results);
              }
            });
        } else {
          if (result !== undefined && result !== null) {
            if (Array.isArray(result)) {
              results.push(...(result as any));
            } else {
              results.push(result as any);
            }
          }
          pending--;
          if (pending === 0) {
            resolve(results);
          }
        }
      }
    });
  }

  async notifyError(
    stage: string,
    error: Error,
    message: Envelope | null,
  ): Promise<void> {
    return new Promise((resolve) => {
      const listeners = this.emitter.listeners("onError");

      if (listeners.length === 0) {
        resolve();
        return;
      }

      let pending = listeners.length;

      for (const listener of listeners) {
        const result = (listener as Function)(stage, error, message);

        if (result instanceof Promise) {
          result
            .catch((err) => {
              console.warn(
                `[HookRuntime] Observer failed for stage ${stage}:`,
                err,
              );
            })
            .finally(() => {
              pending--;
              if (pending === 0) {
                resolve();
              }
            });
        } else {
          pending--;
          if (pending === 0) {
            resolve();
          }
        }
      }
    });
  }

  callFirstSync<T>(hookName: keyof BubFirstResultHooks, args: any[]): T | null {
    const plugins = this.pm.Plugins;

    for (const plugin of plugins) {
      const fn = (plugin.instance as any)[hookName];
      if (!fn) continue;

      try {
        const result = this.invokeSync(fn, args, plugin.name, hookName);

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
