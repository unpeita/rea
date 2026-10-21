import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { QmpConnection } from "../dist/emulator/QmpConnection.js";
import {
  mcpTextValue,
  requireMcpOperationResult,
} from "./lib/mcp-verifier-results.mjs";

const qemu = process.env.REA_QEMU_COMMAND;
assert.ok(
  qemu && isAbsolute(qemu),
  "Set absolute REA_QEMU_COMMAND to qemu-system-arm",
);
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
const directory = new URL("../build/qemu-memory/", import.meta.url);
await mkdir(directory, { recursive: true });
const binary = Buffer.from("2a00a0e3feffffea", "hex"); // ARM: mov r0,#42; b .
const file = fileURLToPath(new URL("fixture.bin", directory));
await writeFile(file, binary);
const input = {
  port,
  expected_name: "rea-synthetic-ce-memory",
  expected_uuid: randomUUID(),
  cpu_index: 0,
};
const child = spawn(
  qemu,
  [
    "-name",
    input.expected_name,
    "-uuid",
    input.expected_uuid,
    "-machine",
    "vexpress-a15",
    "-m",
    "32",
    "-nic",
    "none",
    "-display",
    "none",
    "-serial",
    "none",
    "-monitor",
    "none",
    "-S",
    "-device",
    `loader,addr=0x80000000,file=${file}`,
    "-device",
    "loader,addr=0x80000000,cpu-num=0",
    "-qmp",
    `tcp:127.0.0.1:${port},server=on,wait=off`,
  ],
  { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
);
let stderr = "";
child.stderr.on("data", (data) => {
  stderr = (stderr + data).slice(-8192);
});
const exited = new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code));
});
// Start observing rejection immediately even if setup fails first.
void exited.catch(() => {});
const client = new Client({ name: "rea-qemu-verifier", version: "1" });
const entrypoint = fileURLToPath(new URL("./rea.mjs", import.meta.url));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entrypoint, "mcp"],
  env: { ...process.env, REA_LOG_LEVEL: "silent" },
  stderr: "pipe",
});
async function control(command) {
  const q = new QmpConnection(port);
  try {
    await q.greeting();
    await q.command("qmp_capabilities");
    assert.equal((await q.command("query-uuid")).UUID, input.expected_uuid);
    return await q.command(command);
  } finally {
    await q.close();
  }
}
const call = async (name, args = input) => {
  const result = await client.callTool({ name, arguments: args });
  requireMcpOperationResult(result, name);
  return result.structuredContent ?? JSON.parse(mcpTextValue(result));
};
try {
  await delay(2000);
  assert.equal(child.exitCode, null, stderr);
  await control("cont");
  await delay(100);
  await control("stop");
  await client.connect(transport);
  assert.equal(
    (await call("inspect_emulator_state")).normalized_result.before.status,
    "paused",
  );
  const selection = {
    ...input,
    address: "0x80000000",
    length: binary.length,
    address_space: "physical",
  };
  const mcp = await call("read_emulator_memory", selection);
  assert.equal(mcp.normalized_result.memory.bytes_hex, binary.toString("hex"));
  const virtual = await call("read_emulator_memory", {
    ...selection,
    address_space: "virtual",
  });
  assert.equal(
    virtual.normalized_result.memory.bytes_hex,
    binary.toString("hex"),
  );
  const cli = await promisify(execFile)(
    process.execPath,
    [
      entrypoint,
      "read-emulator-memory",
      ...Object.entries(selection).flatMap(([key, value]) => [
        `--${key}`,
        String(value),
      ]),
      "--json",
    ],
    { timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  const cliResult = JSON.parse(cli.stdout);
  assert.deepEqual(cliResult.normalized_result, mcp.normalized_result);
  await control("cont");
  assert.equal(
    (await call("inspect_emulator_state")).normalized_result.before.running,
    true,
  );
  const rejected = await client.callTool({
    name: "read_emulator_memory",
    arguments: selection,
  });
  assert.throws(() =>
    requireMcpOperationResult(rejected, "read_emulator_memory"),
  );
  console.log(
    JSON.stringify({
      physical_bytes: true,
      virtual_bytes: true,
      cli_mcp_parity: true,
      running_rejected: true,
    }),
  );
} finally {
  await client.close();
  if (child.exitCode === null) {
    try {
      await control("quit");
    } catch {
      child.kill();
    }
  }
  const timer = setTimeout(() => child.kill(), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}
