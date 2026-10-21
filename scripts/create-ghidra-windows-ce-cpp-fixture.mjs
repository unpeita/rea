import { readFile, writeFile } from "node:fs/promises";
// Export one static and one instance C++ member with two explicit integer arguments.
const path = new URL(
  "../build/fixtures/rea-windows-ce-arm.dll",
  import.meta.url,
);
const b = await readFile(path);
b.writeUInt32LE(0x1170, 0x330);
b.writeUInt32LE(0x1190, 0x334);
b.fill(0, 0x370, 0x3c0);
b.write("?Static@CeFixture@@SAHHH@Z\0", 0x370);
b.write("?Instance@CeFixture@@QAAHHH@Z\0", 0x390);
// Export ordinal 1 (Static): r0+r1. Ordinal 0 (Instance): r1+r2.
b.writeUInt32LE(0xe0800001, 0x220);
b.writeUInt32LE(0xe12fff1e, 0x224);
b.writeUInt32LE(0xe0810002, 0x200);
b.writeUInt32LE(0xe12fff1e, 0x204);
await writeFile(
  new URL("../build/fixtures/rea-windows-ce-cpp.dll", import.meta.url),
  b,
);
