export function field(data: any, key: string, defaultValue: any = null): any {
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    if (key in data) {
      return data[key];
    }
  }
  if (data && typeof data === "object" && key in data) {
    return data[key];
  }
  return defaultValue;
}

export function expandToolCalls(
  calls: Record<string, any>[],
): Record<string, any>[] {
  const result: Record<string, any>[] = [];
  for (const call of calls) {
    result.push(..._expandToolCall(call));
  }
  return result;
}

function _expandToolCall(call: Record<string, any>): Record<string, any>[] {
  const func = field(call, "function");
  if (typeof func !== "object" || func === null) {
    return [{ ...call }];
  }

  const arguments_ = field(func, "arguments");
  if (typeof arguments_ !== "string") {
    return [{ ...call }];
  }

  const chunks = _splitConcatenatedJsonObjects(arguments_);
  if (chunks.length === 0) {
    return [{ ...call }];
  }

  const callId = field(call, "id");
  const expanded: Record<string, any>[] = [];
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];
    const cloned: Record<string, any> = { ...call };
    const clonedFunction: Record<string, any> = { ...func };
    clonedFunction["arguments"] = chunk;
    cloned["function"] = clonedFunction;
    if (typeof callId === "string" && callId && index > 0) {
      cloned["id"] = `${callId}__${index + 1}`;
    }
    expanded.push(cloned);
  }
  return expanded;
}

function _splitConcatenatedJsonObjects(raw: string): string[] {
  const chunks: string[] = [];
  let position = 0;
  const total = raw.length;

  while (position < total) {
    while (position < total && /\s/.test(raw[position])) {
      position++;
    }
    if (position >= total) {
      break;
    }

    try {
      const parsed = JSON.parse(raw.slice(position));
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return [];
      }
      const end = _findJsonEnd(raw, position);
      if (end === -1) {
        return [];
      }
      chunks.push(raw.slice(position, end));
      position = end;
    } catch (exc) {
      return [];
    }
  }

  if (chunks.length <= 1) {
    return [];
  }
  return chunks;
}

function _findJsonEnd(str: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = start; i < str.length; i++) {
    const char = str[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
  }

  return -1;
}
