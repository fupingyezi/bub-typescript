import { PluginMeta, BubHooks, BUB_HOOK_NAMES } from "./types";

/**
 * bub 插件管理器，负责注册插件并按优先级排序。
 */
export class BubPluginManager {
  private plugins: PluginMeta[] = [];

  /**
   * 注册一个插件并按优先级重新排序。
   * @param name - 插件名称
   * @param hooks - 插件实现的钉子对象
   * @param priority - 插件优先级，数字越大越先执行，默认 0
   */
  register(name: string, hooks: BubHooks, priority: number = 0) {
    this.plugins.push({ name, instance: hooks, priority });
    this.plugins.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 获取按优先级排序的插件列表。
   */
  get Plugins() {
    return this.plugins;
  }

  /**
   * 生成钉子实现报告，以钉子名为 key、实现该钉子的插件名数组为 value。
   * 只包含至少有一个插件实现的钉子。
   */
  get hooksReport(): Record<string, string[]> {
    const report: Record<string, string[]> = {};
    for (const hookName of BUB_HOOK_NAMES) {
      const adapters = this.Plugins.filter(
        (p) => typeof (p.instance as any)[hookName] === "function",
      );
      if (adapters.length) {
        report[hookName] = adapters.map((p) => p.name);
      }
    }
    return report;
  }
}
