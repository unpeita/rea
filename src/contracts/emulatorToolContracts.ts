import {
  emulatorEndpointSchema,
  emulatorMemoryInputSchema,
  emulatorReportSchema,
} from "../domain/emulator.js";
import { toolContractMetadata } from "./toolEffects.js";
import { evidenceResultOf } from "./toolOutputSchemaPrimitives.js";
import type { ToolContract } from "./toolContractTypes.js";
export const EMULATOR_TOOL_CONTRACTS = [
  {
    name: "inspect_emulator_state",
    ...toolContractMetadata("inspect_emulator_state"),
    kind: "native-provider",
    description:
      "Observe an existing local QEMU guest through QMP on 127.0.0.1. Require exact -name and nonzero -uuid, report running/paused state and selected vCPU register text. Never starts, stops, resumes or owns the VM. Running registers are a sequential live sample, not an atomic snapshot or Windows CE process identity. Each call closes its socket; 10 second/1 MiB transport bounds.",
    examples: [],
    inputSchema: emulatorEndpointSchema,
    outputSchema: evidenceResultOf(emulatorReportSchema),
  },
  {
    name: "read_emulator_memory",
    ...toolContractMetadata("read_emulator_memory"),
    kind: "native-provider",
    description:
      "Read 1–4096 bytes at a 32-bit guest address from an already paused QEMU guest through loopback QMP. Require exact name and nonzero UUID. Explicit physical or current-vCPU virtual address space; no Windows CE process selection or automatic module mapping. Never pauses/resumes the guest. Only select known RAM: MMIO reads can alter device state. Reject incomplete dumps and observed state transitions; other debugger clients/devices can still change memory. Returns bytes as hexadecimal with register/state context.",
    examples: [],
    inputSchema: emulatorMemoryInputSchema,
    outputSchema: evidenceResultOf(emulatorReportSchema),
  },
] as const satisfies readonly ToolContract[];
