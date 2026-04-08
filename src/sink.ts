import type { PluginHookName } from "./types.js";

export interface EventSink {
  appendBatch(
    hookName: PluginHookName,
    rows: Record<string, unknown>[],
  ): Promise<void>;
  close(): void;
}

/**
 * Decorator that wraps another EventSink, recording all appendBatch calls
 * while forwarding them to the underlying sink.
 *
 * Used in integration tests to assert what data was written.
 */
export class RecordingSink implements EventSink {
  private readonly delegate: EventSink;
  private readonly calls: { hookName: PluginHookName; rows: Record<string, unknown>[] }[] = [];

  constructor(delegate: EventSink) {
    this.delegate = delegate;
  }

  async appendBatch(
    hookName: PluginHookName,
    rows: Record<string, unknown>[],
  ): Promise<void> {
    this.calls.push({ hookName, rows: [...rows] });
    return this.delegate.appendBatch(hookName, rows);
  }

  /** Get all recorded appendBatch calls. */
  getCalls(): readonly { hookName: PluginHookName; rows: Record<string, unknown>[] }[] {
    return this.calls;
  }

  /** Get all collected rows, optionally filtered by hook name. */
  getEvents(hookName?: PluginHookName): Record<string, unknown>[] {
    const calls = hookName
      ? this.calls.filter((c) => c.hookName === hookName)
      : this.calls;
    return calls.flatMap((c) => c.rows);
  }

  /** Total number of recorded rows across all hooks. */
  getEventCount(): number {
    return this.calls.reduce((sum, c) => sum + c.rows.length, 0);
  }

  /** Clear all recorded data. */
  clear(): void {
    this.calls.length = 0;
  }

  close(): void {
    this.delegate.close();
  }
}

/**
 * EventSink that prints each batch to stdout in a structured, readable format.
 * Used for local debugging — not for tests or production.
 */
export class ConsoleSink implements EventSink {
  appendBatch(
    hookName: PluginHookName,
    rows: Record<string, unknown>[],
  ): Promise<void> {
    for (const row of rows) {
      console.log(
        `[fluss-hook:console] hook=${hookName} rows=${rows.length}`,
        JSON.stringify(row, null, 2),
      );
    }
    return Promise.resolve();
  }

  close(): void {}
}
