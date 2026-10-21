import {
  emulatorEndpointSchema,
  emulatorMemoryInputSchema,
} from "../domain/emulator.js";
import { createEmulatorService } from "../composition/emulator.js";
import type { EmulatorService } from "../application/EmulatorService.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { finishAnalysisCommand } from "./finishAnalysisCommand.js";
export const registerEmulatorCommands = (
  cli: CliInstance,
  logger: Logger,
  service: EmulatorService = createEmulatorService(),
): void => {
  cli.command(CLI_COMMANDS.inspectEmulatorState, {
    description:
      "Observe an existing local QEMU guest's state and vCPU registers",
    options: emulatorEndpointSchema,
    run: ({ options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.inspectEmulatorState, () =>
          finishAnalysisCommand(
            () => service.inspect(options, false, { signal }),
            service,
            "qemu-qmp",
            "inspect_emulator_state",
            signal,
          ),
        ),
      ),
  });
  cli.command(CLI_COMMANDS.readEmulatorMemory, {
    description: "Read bounded memory from an already paused local QEMU guest",
    options: emulatorMemoryInputSchema,
    run: ({ options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.readEmulatorMemory, () =>
          finishAnalysisCommand(
            () => service.inspect(options, true, { signal }),
            service,
            "qemu-qmp",
            "read_emulator_memory",
            signal,
          ),
        ),
      ),
  });
};
