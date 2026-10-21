import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { EmulatorService } from "../application/EmulatorService.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { Logger } from "pino";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { createEvidenceToolHandler } from "./contractToolHandler.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";
export const registerEmulatorTools = (
  server: EvidenceMcpServer,
  service: EmulatorService,
  logger: Logger,
  recordEvidence?: EvidenceWriter["recordEvidence"],
  withAdmittedAnalysis?: WithAdmittedAnalysis,
): void => {
  for (const name of [
    "inspect_emulator_state",
    "read_emulator_memory",
  ] as const) {
    const contract = toolContract(name);
    const handler = createEvidenceToolHandler(
      server,
      (input, options) =>
        service.inspect(input, name === "read_emulator_memory", options),
      logger,
      recordEvidence,
      withAdmittedAnalysis,
    );
    server.registerTool(
      name,
      toolRegistrationOptions(contract),
      handler(contract),
    );
  }
};
