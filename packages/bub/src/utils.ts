import * as path from 'path';
import * as os from 'os';

type State = Record<string, any>;

interface TapeEntry {
  payload: any;
  kind?: string;
}

export function excludeNone(d: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(d)) {
    if (v !== null && v !== undefined) {
      result[k] = v;
    }
  }
  return result;
}

export function workspaceFromState(state: State): string {
  const raw = state['_runtime_workspace'];
  if (typeof raw === 'string' && raw.trim()) {
    const expanded = raw.startsWith('~') ? raw.replace(/^~/, os.homedir()) : raw;
    return path.resolve(expanded);
  }
  return process.cwd();
}

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
