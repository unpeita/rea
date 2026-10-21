import { z } from "zod";
import type { EmulatorPort } from "../application/EmulatorService.js";
import {
  createAnalysisExecution,
  type AnalysisExecution,
  type ExecutionOptions,
} from "../application/AnalysisProvider.js";
import {
  emulatorStateSchema,
  type EmulatorEndpoint,
  type EmulatorMemoryInput,
} from "../domain/emulator.js";
import {
  AnalysisCancelledError,
  AnalysisProtocolError,
} from "../domain/analysisErrorCore.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { err, ok, type Result } from "../domain/result.js";
import { QmpConnection } from "./QmpConnection.js";

export const QEMU_PROVIDER_IDENTITY = {
  id: "qemu-qmp",
  name: "QEMU QMP",
  version: null,
};

export function parseMemoryDump(
  text: string,
  address: string,
  length: number,
): string {
  const bytes: string[] = [];
  for (const line of text.trim().split(/\r?\n/)) {
    const match = /^([0-9a-fA-Fx]+):\s+((?:0x[0-9a-fA-F]{2}(?:\s+|$))+)$/.exec(
      line,
    );
    if (
      !match ||
      BigInt(match[1]!.startsWith("0x") ? match[1]! : "0x" + match[1]!) !==
        BigInt(address) + BigInt(bytes.length)
    )
      throw new Error(
        "Incomplete, noncontiguous or malformed QEMU memory dump",
      );
    bytes.push(
      ...match[2]!
        .trim()
        .split(/\s+/)
        .map((value) => value.slice(2).toLowerCase()),
    );
    if (bytes.length > length) throw new Error("Excess QEMU memory bytes");
  }
  if (bytes.length !== length) throw new Error("Truncated QEMU memory dump");
  return bytes.join("");
}
export class QemuEmulatorAdapter implements EmulatorPort {
  #connections = new Set<QmpConnection>();
  async close(): Promise<void> {
    await Promise.all([...this.#connections].map((c) => c.close()));
  }
  async observe(
    input: EmulatorEndpoint | EmulatorMemoryInput,
    options?: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    const operation =
      "address" in input ? "read_emulator_memory" : "inspect_emulator_state";
    if (options?.signal?.aborted)
      return err(new AnalysisCancelledError(operation));
    const connection = new QmpConnection(input.port, options?.signal);
    this.#connections.add(connection);
    try {
      const greeting = z
        .object({
          QMP: z.object({
            version: z.object({
              qemu: z.object({
                major: z.number().int(),
                minor: z.number().int(),
                micro: z.number().int(),
              }),
            }),
          }),
        })
        .parse(await connection.greeting());
      const v = greeting.QMP.version.qemu;
      const version = `${v.major}.${v.minor}.${v.micro}`;
      await connection.command("qmp_capabilities");
      const { name } = z
        .object({ name: z.string() })
        .parse(await connection.command("query-name"));
      const { UUID: uuid } = z
        .object({ UUID: z.string().uuid() })
        .parse(await connection.command("query-uuid"));
      if (
        name !== input.expected_name ||
        uuid.toLowerCase() !== input.expected_uuid.toLowerCase()
      )
        throw new Error("QEMU name/UUID do not match the selected guest");
      const cpus = z
        .array(z.object({ "cpu-index": z.number().int() }))
        .parse(await connection.command("query-cpus-fast"));
      if (!cpus.some((cpu) => cpu["cpu-index"] === input.cpu_index))
        throw new Error("Selected vCPU is absent");
      const state = async () =>
        emulatorStateSchema.parse(
          await connection.command("query-status").then((v) => {
            const parsed = z
              .object({ running: z.boolean(), status: z.string() })
              .parse(v);
            return parsed;
          }),
        );
      const before = await state();
      if ("address" in input && (before.running || before.status !== "paused"))
        throw new Error(
          "Memory observation requires an already paused guest; REA does not pause it",
        );
      const hmp = async (line: string) =>
        z
          .string()
          .max(65536)
          .parse(
            await connection.command("human-monitor-command", {
              "command-line": line,
              "cpu-index": input.cpu_index,
            }),
          );
      const registers = await hmp("info registers");
      if (!/\b(?:R0[ =]|R00=|PC=|EIP=|RIP=)/i.test(registers))
        throw new Error("Unrecognized register response");
      const memory =
        "address" in input
          ? {
              address: input.address,
              address_space: input.address_space,
              bytes_hex: parseMemoryDump(
                await hmp(
                  `${input.address_space === "physical" ? "xp" : "x"} /${input.length}bx ${input.address}`,
                ),
                input.address,
                input.length,
              ),
            }
          : null;
      const after = await state();
      if (
        memory &&
        (after.running || after.status !== "paused" || connection.stateChanged)
      )
        throw new Error("Guest state changed during memory observation");
      return ok(
        createAnalysisExecution(
          {
            selection: input,
            identity: { name, uuid, version },
            before,
            after,
            registers,
            memory,
          },
          { ...QEMU_PROVIDER_IDENTITY, version },
          {
            limitations: [
              "QMP name/UUID identify the selected local guest but do not authenticate the endpoint.",
              "Observations are sequential, not an atomic snapshot. Other debugger clients and devices may change memory; running registers are a live sample.",
              "Virtual memory uses the selected vCPU's current address space, not a selected Windows CE process. No process/module ownership is inferred.",
              "Reads of memory-mapped device registers can have side effects. Select known RAM; REA does not classify addresses as RAM or MMIO.",
            ],
          },
        ),
      );
    } catch (cause) {
      return err(
        options?.signal?.aborted
          ? new AnalysisCancelledError(operation, { cause })
          : cause instanceof AnalysisError
            ? cause
            : new AnalysisProtocolError(
                cause instanceof Error
                  ? cause.message
                  : "QMP observation failed",
                { cause },
              ),
      );
    } finally {
      await connection.close();
      this.#connections.delete(connection);
    }
  }
}
