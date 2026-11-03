// Bounded waits for page fetches and model-backed tool calls. One slow
// page must never eat the whole platform time slice: every guarded wait
// rejects with a ToolTimeoutError the caller turns into a structured
// { error } tool result, so the model moves on to another page.

export class ToolTimeoutError extends Error {
  readonly tool: string;
  readonly timeoutMs: number;
  constructor(tool: string, timeoutMs: number) {
    super(`${tool} timed out after ${timeoutMs}ms`);
    this.name = 'ToolTimeoutError';
    this.tool = tool;
    this.timeoutMs = timeoutMs;
  }
}

/** One page fetch that drags past this hands a structured timeout to the model instead of eating the turn. */
export const FETCH_TOOL_TIMEOUT_MS = 15_000;
/** One reader call that drags past this hands a structured timeout to the model so the turn can move on. */
export const READER_TOOL_TIMEOUT_MS = 20_000;
/** Reader input cap: very large pages slow the reader and add nothing past this. */
export const READER_MAX_CHARS = 15_000;

/** Race `work` against a timer. The loser of the race settles silently. */
export async function withTimeout<T>(work: Promise<T>, timeoutMs: number, tool: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ToolTimeoutError(tool, timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
