import { EmulatorService } from "../application/EmulatorService.js";
import { QemuEmulatorAdapter } from "../emulator/QemuEmulatorAdapter.js";
export const createEmulatorService = (): EmulatorService =>
  new EmulatorService(new QemuEmulatorAdapter());
