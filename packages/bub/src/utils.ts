import * as path from 'path';
import * as os from 'os';

type State = Record<string, any>;

interface TapeEntry {
  payload: any;
  kind?: string;
}

/**
 * 过滤掉对象中值为 null 或 undefined 的键，返回新对象。
 * @param d - 待过滤的键值对对象
 * @returns 不含 null/undefined 值的新对象
 */
export function excludeNone(d: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(d)) {
    if (v !== null && v !== undefined) {
      result[k] = v;
    }
  }
  return result;
}

/**
 * 从运行时 state 中解析工作区路径。
 * 若 state 中存在 `_runtime_workspace` 字段，则以其为基础解析绝对路径（支持 `~` 展开）；
 * 否则回退到当前进程工作目录。
 * @param state - 运行时状态对象
 * @returns 解析后的绝对工作区路径
 */
export function workspaceFromState(state: State): string {
  const raw = state['_runtime_workspace'];
  if (typeof raw === 'string' && raw.trim()) {
    const expanded = raw.startsWith('~') ? raw.replace(/^~/, os.homedir()) : raw;
    return path.resolve(expanded);
  }
  return process.cwd();
}

/**
 * 从 TapeEntry 中提取可读文本内容。
 * - `message` 类型：返回 `payload.content`
 * - `tool_result` 类型：返回 `payload.results`
 * - `tool_call` 类型：返回 `payload.calls`
 * - 其他类型：返回 JSON 序列化结果
 * @param entry - Tape 条目对象
 * @returns 条目的文本表示，若无内容则返回空字符串
 */
export function getEntryText(entry: TapeEntry): string {
  if (!entry || !entry.payload) {
    return '';
  }

  const { kind, payload } = entry;

  if (kind === 'message') {
    return payload.content ?? '';
  }

  if (kind === 'tool_result') {
    return payload.results ?? '';
  }

  if (kind === 'tool_call') {
    return payload.calls ?? '';
  }

  return JSON.stringify(payload);
}

/**
 * 等待异步任务完成，同时轮询停止事件。
 * 若 `stopEvent.isSet()` 在任务完成前返回 `true`，则抛出取消错误。
 * @param coro - 需要等待的异步任务
 * @param stopEvent - 停止信号对象，提供 `isSet()` 方法
 * @returns 任务完成后的返回值
 * @throws 若停止事件触发，抛出 `Error('Operation cancelled due to stop event')`
 */
export async function waitUntilStopped<T>(
  coro: Promise<T>,
  stopEvent: { isSet: () => boolean }
): Promise<T> {
  let finished = false;
  let result: T;
  let error: unknown;

  coro.then((res) => {
    result = res;
    finished = true;
  }).catch((err) => {
    error = err;
    finished = true;
  });

  while (!finished) {
    if (stopEvent.isSet()) {
      throw new Error('Operation cancelled due to stop event');
    }
    await new Promise((resolve) => setImmediate(resolve));
  }

  if (error !== undefined) {
    throw error;
  }
  return result!;
}
