import { Socket } from "node:net";
import {
  AnalysisResourceConstraintError,
  AnalysisTimeoutError,
} from "../domain/analysisErrorCore.js";

/** A single bounded, sequential QMP conversation. Never owns the guest process. */
export class QmpConnection {
  readonly socket = new Socket();
  readonly closed: Promise<void>;
  #buffer = "";
  #bytes = 0;
  #failure: Error | undefined;
  #pending:
    | {
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
        id?: number;
      }
    | undefined;
  #id = 0;
  #timer: ReturnType<typeof setTimeout>;
  #signal: AbortSignal | undefined;
  readonly #abort = () => this.fail(new Error("QMP observation cancelled"));
  stateChanged = false;
  constructor(port: number, signal?: AbortSignal) {
    this.#signal = signal;
    this.closed = new Promise((resolve) => this.socket.once("close", resolve));
    this.#timer = setTimeout(
      () => this.fail(new AnalysisTimeoutError("observe_emulator", 10000)),
      10000,
    );
    this.socket.setEncoding("utf8");
    this.socket.on("error", (e) => this.fail(e));
    this.socket.on("close", () => {
      clearTimeout(this.#timer);
      signal?.removeEventListener("abort", this.#abort);
      this.fail(new Error("QMP connection closed"));
    });
    this.socket.on("data", (chunk: string) => {
      this.#bytes += Buffer.byteLength(chunk);
      if (this.#bytes > 1024 * 1024) {
        this.fail(
          new AnalysisResourceConstraintError(
            "observe_emulator",
            "transport",
            "QMP response exceeds 1 MiB",
            { max_bytes: 1048576 },
          ),
        );
        return;
      }
      this.#buffer += chunk;
      let end: number;
      while ((end = this.#buffer.indexOf("\n")) >= 0 && !this.#failure) {
        const line = this.#buffer.slice(0, end);
        this.#buffer = this.#buffer.slice(end + 1);
        try {
          const message: unknown = JSON.parse(line);
          if (!message || typeof message !== "object")
            throw new Error("Invalid QMP object");
          if ("event" in message) {
            if (
              ["STOP", "RESUME", "RESET", "SHUTDOWN"].includes(
                String(message.event),
              )
            )
              this.stateChanged = true;
            continue;
          }
          const pending = this.#pending;
          if (!pending) throw new Error("Unexpected QMP response");
          if (
            pending.id === undefined
              ? !("QMP" in message)
              : !("id" in message) || message.id !== pending.id
          )
            throw new Error("Mismatched QMP response");
          this.#pending = undefined;
          if ("error" in message)
            pending.reject(
              new Error(
                "QMP command rejected: " + JSON.stringify(message.error),
              ),
            );
          else if (pending.id === undefined) pending.resolve(message);
          else if ("return" in message) pending.resolve(message.return);
          else pending.reject(new Error("Missing QMP return"));
        } catch (e) {
          this.fail(e instanceof Error ? e : new Error("Invalid QMP response"));
        }
      }
    });
    signal?.addEventListener("abort", this.#abort, { once: true });
    // connect after the consumer can install the greeting waiter.
    queueMicrotask(() => {
      if (signal?.aborted) this.#abort();
      if (!this.#failure) this.socket.connect(port, "127.0.0.1");
    });
  }
  fail(error: Error): void {
    this.#failure ??= error;
    this.#pending?.reject(this.#failure);
    this.#pending = undefined;
    this.socket.destroy();
  }
  greeting(): Promise<unknown> {
    return this.#wait();
  }
  #wait(id?: number): Promise<unknown> {
    if (this.#failure) return Promise.reject(this.#failure);
    if (this.#pending)
      return Promise.reject(new Error("Concurrent QMP request"));
    return new Promise((resolve, reject) => {
      this.#pending = { resolve, reject, ...(id === undefined ? {} : { id }) };
    });
  }
  command(execute: string, args?: Record<string, unknown>): Promise<unknown> {
    if (this.#pending)
      return Promise.reject(new Error("Concurrent QMP request"));
    const id = ++this.#id;
    const result = this.#wait(id);
    if (!this.#failure)
      this.socket.write(
        JSON.stringify({ execute, id, ...(args ? { arguments: args } : {}) }) +
          "\r\n",
      );
    return result;
  }
  async close(): Promise<void> {
    clearTimeout(this.#timer);
    this.#signal?.removeEventListener("abort", this.#abort);
    this.fail(new Error("QMP observation finished"));
    await this.closed;
  }
}
