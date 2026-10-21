import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { parseEvidence } from "../dist/domain/evidence.js";
import { verifyGhidraFileOffsets } from "./lib/real-ghidra-file-offsets.mjs";
import {
  createGhidraVerifierMcpOperations,
  resolveGhidraVerifierTimeouts,
} from "./lib/ghidra-verifier-timeouts.mjs";
import {
  mcpTextValue,
  requireMcpOperationResult,
} from "./lib/mcp-verifier-results.mjs";

if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error(
    "Windows CE verification requires a Windows x64 analysis host",
  );
const entrypoint = fileURLToPath(new URL("./rea.mjs", import.meta.url));
const { requestOptions } = resolveGhidraVerifierTimeouts(process.env);
const results = [];
for (const instructionSet of ["arm", "thumb"]) {
  for (const extension of ["exe", "dll"]) {
    const filename = `rea-windows-ce-${instructionSet}.${extension}`;
    const path = fileURLToPath(
      new URL(`../build/fixtures/${filename}`, import.meta.url),
    );
    const before = await readFile(path);
    const client = new Client({ name: "rea-ce-verifier", version: "1" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entrypoint, "mcp"],
      env: {
        ...process.env,
        REA_ANALYSIS_PROVIDER: "ghidra",
        REA_LOG_LEVEL: "silent",
      },
      stderr: "pipe",
    });
    const mcp = createGhidraVerifierMcpOperations(client, requestOptions);
    const call = async (name, arguments_ = {}) => {
      const result = await mcp.callTool({ name, arguments: arguments_ });
      requireMcpOperationResult(result, name);
      return result.structuredContent ?? JSON.parse(mcpTextValue(result));
    };
    try {
      await mcp.connect(transport);
      await call("open_binary", { path, provider_id: "ghidra" });
      const answer = parseEvidence(
        await call("procedure_pseudo_code", { procedure: "CeAnswer" }),
      );
      const caller = parseEvidence(
        await call("procedure_pseudo_code", { procedure: "CeCaller" }),
      );
      assert.match(answer.normalized_result, /return\s+(0x2a|42)\s*;/i);
      assert.match(caller.normalized_result, /CeAnswer\(/);
      assert.match(caller.normalized_result, /return\s+[^;]+\+\s*1\s*;/);
      assert.equal(
        answer.analysis_profile.parameters.windows_arm_pe_subsystem,
        9,
      );
      assert.equal(
        answer.analysis_profile.parameters.windows_arm_pe_machine,
        instructionSet === "thumb" ? 0x01c2 : 0x01c0,
      );
      await call("close_binary");
    } finally {
      await client.close();
    }
    assert.deepEqual(await readFile(path), before);
    results.push({
      filename,
      constant_return: 42,
      caller_adds_one: true,
      source_unchanged: true,
    });
    console.log(JSON.stringify(results.at(-1)));
  }
}
const offsets = await verifyGhidraFileOffsets(
  fileURLToPath(
    new URL("../build/fixtures/rea-windows-ce-thumb.dll", import.meta.url),
  ),
  entrypoint,
  "0x10001000",
);
console.log(JSON.stringify({ windows_ce: results, file_offsets: offsets }));
