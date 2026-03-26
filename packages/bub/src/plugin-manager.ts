import { PluginMeta, BubHooks, BUB_HOOK_NAMES } from "./types";

export class BubPluginManager {
  private plugins: PluginMeta[] = [];

  register(name: string, hooks: BubHooks, priority: number = 0) {
    this.plugins.push({ name, instance: hooks, priority });
    this.plugins.sort((a, b) => b.priority - a.priority);
  }

  get Plugins() {
    return this.plugins;
  }

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
