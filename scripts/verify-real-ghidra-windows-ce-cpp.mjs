import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import {
  requireMcpOperationResult,
  mcpTextValue,
} from "./lib/mcp-verifier-results.mjs";
const path = fileURLToPath(
  new URL("../build/fixtures/rea-windows-ce-cpp.dll", import.meta.url),
);
const before = await readFile(path);
const client = new Client({ name: "rea-ce-cpp-verifier", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL("./rea.mjs", import.meta.url)), "mcp"],
  env: { ...process.env, REA_LOG_LEVEL: "silent" },
  stderr: "pipe",
});
const call = async (name, args = {}) => {
  const r = await client.callTool(
    { name, arguments: args },
    { timeout: 900000 },
  );
  requireMcpOperationResult(r, name);
  return r.structuredContent ?? JSON.parse(mcpTextValue(r));
};
try {
  await client.connect(transport);
  await call("open_binary", { path, provider_id: "ghidra" });
  const stat = await call("procedure_pseudo_code", { procedure: "0x10001020" });
  const inst = await call("procedure_pseudo_code", { procedure: "0x10001000" });
  assert.doesNotMatch(stat.normalized_result, /\bthis\b/);
  assert.match(stat.normalized_result, /Static\(int \w+,int \w+\)/);
  assert.match(inst.normalized_result, /\bthis\b/);
  assert.equal(
    stat.analysis_profile.parameters.windows_ce_static_members,
    "decorated-static-no-this-v1",
  );
  console.log(
    JSON.stringify({
      static: stat.normalized_result,
      instance: inst.normalized_result,
    }),
  );
  await call("close_binary");
} finally {
  await client.close();
}
assert.deepEqual(await readFile(path), before);
