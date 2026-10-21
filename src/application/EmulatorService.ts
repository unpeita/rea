import {
  emulatorEndpointSchema,
  emulatorMemoryInputSchema,
  emulatorReportSchema,
  type EmulatorEndpoint,
  type EmulatorMemoryInput,
} from "../domain/emulator.js";
import { createEvidence, type Evidence } from "../domain/evidence.js";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import { err, ok, type Result } from "../domain/result.js";
import type {
  AnalysisExecution,
  ExecutionOptions,
} from "./AnalysisProvider.js";

export interface EmulatorPort {
  observe(
    input: EmulatorEndpoint | EmulatorMemoryInput,
    options?: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>>;
  close(): Promise<void>;
}
export class EmulatorService {
  constructor(readonly provider: EmulatorPort) {}
  close(): Promise<void> {
    return this.provider.close();
  }
  async inspect(
    raw: unknown,
    memory: boolean,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    const operation = memory
      ? "read_emulator_memory"
      : "inspect_emulator_state";
    if (options?.signal?.aborted)
      return err(new AnalysisCancelledError(operation));
    const parsed = (
      memory ? emulatorMemoryInputSchema : emulatorEndpointSchema
    ).safeParse(raw);
    if (!parsed.success)
      return err(
        analysisInputErrorFromIssues(operation, parsed.error.issues, raw),
      );
    const result = await this.provider.observe(parsed.data, options);
    if (!result.ok) return result;
    const execution = result.value;
    const report = emulatorReportSchema.safeParse(execution.result);
    const selectedMemory = emulatorMemoryInputSchema.safeParse(parsed.data);
    if (
      !report.success ||
      JSON.stringify(report.data.selection) !== JSON.stringify(parsed.data) ||
      report.data.identity.name !== parsed.data.expected_name ||
      report.data.identity.uuid.toLowerCase() !==
        parsed.data.expected_uuid.toLowerCase() ||
      (memory
        ? report.data.memory === null ||
          !selectedMemory.success ||
          report.data.memory.bytes_hex.length !==
            selectedMemory.data.length * 2 ||
          report.data.memory.address !== selectedMemory.data.address ||
          report.data.memory.address_space !==
            selectedMemory.data.address_space ||
          report.data.before.status !== "paused" ||
          report.data.before.running ||
          report.data.after.status !== "paused" ||
          report.data.after.running
        : report.data.memory !== null)
    )
      return err(
        new AnalysisOutputError(
          operation,
          "Invalid emulator observation or changed selection/identity",
        ),
      );
    const evidence = createEvidence(undefined, execution.provider, {
      operation,
      parameters: parsed.data,
      result: report.data,
      confidence: "observed",
      locations: execution.locations,
      limitations: execution.limitations,
    });
    return options?.signal?.aborted
      ? err(
          new AnalysisCancelledError(operation, {
            partialObservation: evidence,
          }),
        )
      : ok(evidence);
  }
}
