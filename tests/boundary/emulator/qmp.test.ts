import { createServer, type Socket } from "node:net";
import { describe, expect, it } from "vitest";
import {
  QemuEmulatorAdapter,
  parseMemoryDump,
} from "../../../src/emulator/QemuEmulatorAdapter.js";
import { EmulatorService } from "../../../src/application/EmulatorService.js";
import { emulatorMemoryInputSchema } from "../../../src/domain/emulator.js";

const uuid = "bf83f3b0-a71b-43b2-ae33-06cd2a8f6d36";
async function fixture(
  options: {
    running?: boolean;
    wrongIdentity?: boolean;
    truncated?: boolean;
    resume?: boolean;
    stall?: boolean;
    oversized?: boolean;
  } = {},
) {
  const commands: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.setEncoding("utf8");
    if (options.stall) return;
    socket.write(
      JSON.stringify({
        QMP: { version: { qemu: { major: 9, minor: 2, micro: 0 } } },
      }) + "\n",
    );
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const request = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        commands.push(request.execute);
        let value: unknown = {};
        switch (request.execute) {
          case "query-name":
            value = { name: options.wrongIdentity ? "other" : "ce-test" };
            break;
          case "query-uuid":
            value = { UUID: uuid };
            break;
          case "query-cpus-fast":
            value = [{ "cpu-index": 0 }];
            break;
          case "query-status":
            value = {
              running: !!options.running,
              status: options.running ? "running" : "paused",
              singlestep: false,
            };
            break;
          case "human-monitor-command":
            expect(request.arguments["cpu-index"]).toBe(0);
            const line = request.arguments["command-line"];
            commands.push(line);
            value =
              line === "info registers"
                ? "R00=00000000 R15=800010c0"
                : options.truncated
                  ? "00001000: 0x01"
                  : "00001000: 0x01 0x02 0xa0 0xff";
            if (options.resume && line !== "info registers")
              socket.write('{"event":"RESUME"}\n');
            if (options.oversized) {
              socket.write("x".repeat(1024 * 1024 + 1));
              return;
            }
        }
        // Deliberately split frames across chunks.
        const response =
          JSON.stringify({ return: value, id: request.id }) + "\n";
        socket.write(response.slice(0, 5));
        socket.write(response.slice(5));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  const input = {
    port: address.port,
    expected_name: "ce-test",
    expected_uuid: uuid,
    cpu_index: 0,
  };
  const service = new EmulatorService(new QemuEmulatorAdapter());
  return {
    input,
    commands,
    service,
    async close() {
      await service.close();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    },
  };
}
const memory = {
  address: "0x1000",
  length: 4,
  address_space: "virtual",
} as const;
describe("bounded QMP observations", () => {
  it("delivers memory and provenance without guest-control commands", async () => {
    const f = await fixture();
    try {
      const result = await f.service.inspect({ ...f.input, ...memory }, true);
      expect(result.ok).toBe(true);
      if (result.ok)
        expect(result.value.normalized_result).toMatchObject({
          memory: { bytes_hex: "0102a0ff" },
          before: { status: "paused" },
        });
      expect(f.commands).toEqual([
        "qmp_capabilities",
        "query-name",
        "query-uuid",
        "query-cpus-fast",
        "query-status",
        "human-monitor-command",
        "info registers",
        "human-monitor-command",
        "x /4bx 0x1000",
        "query-status",
      ]);
    } finally {
      await f.close();
    }
  });
  it.each([
    { running: true },
    { wrongIdentity: true },
    { truncated: true },
    { resume: true },
    { oversized: true },
  ])("rejects unsafe or incomplete observation %j", async (options) => {
    const f = await fixture(options);
    try {
      const result = await f.service.inspect({ ...f.input, ...memory }, true);
      expect(result.ok).toBe(false);
      if (options.running || options.wrongIdentity)
        expect(f.commands).not.toContain("x /4bx 0x1000");
    } finally {
      await f.close();
    }
  });
  it("reports running status without requiring a pause", async () => {
    const f = await fixture({ running: true });
    try {
      const result = await f.service.inspect(f.input, false);
      expect(result.ok).toBe(true);
      if (result.ok)
        expect(result.value.normalized_result).toMatchObject({
          before: { running: true },
          memory: null,
        });
    } finally {
      await f.close();
    }
  });
  it("cancels a peer that never sends a greeting and closes its socket", async () => {
    const f = await fixture({ stall: true });
    try {
      const abort = new AbortController();
      const pending = f.service.inspect(f.input, false, {
        signal: abort.signal,
      });
      abort.abort();
      const result = await pending;
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error._tag).toBe("AnalysisCancelledError");
    } finally {
      await f.close();
    }
  });
  it("bounds a peer that never completes the greeting", async () => {
    const f = await fixture({ stall: true });
    try {
      const result = await f.service.inspect(f.input, false);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error._tag).toBe("AnalysisTimeoutError");
    } finally {
      await f.close();
    }
  }, 15000);
  it("service close releases an in-flight observation", async () => {
    const f = await fixture({ stall: true });
    try {
      const pending = f.service.inspect(f.input, false);
      await f.service.close();
      expect((await pending).ok).toBe(false);
    } finally {
      await f.close();
    }
  });
  it("rejects malformed address, injected command and address wrap", () => {
    for (const change of [
      { address: "0x10;quit" },
      { address: "0xffffffff", length: 2 },
      { length: 4097 },
      { host: "remote" },
    ])
      expect(
        emulatorMemoryInputSchema.safeParse({
          port: 1234,
          expected_name: "ce-test",
          expected_uuid: uuid,
          ...memory,
          ...change,
        }).success,
      ).toBe(false);
    expect(() => parseMemoryDump("00001001: 0x01", "0x1000", 1)).toThrow();
    expect(() =>
      parseMemoryDump("Cannot access memory", "0x1000", 1),
    ).toThrow();
  });
});
