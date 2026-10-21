import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Synthetic PE32 fixtures for static analysis. No vendor SDK, OS or target execution.
const output = new URL("../build/fixtures/", import.meta.url);
await mkdir(output, { recursive: true });
for (const thumb of [false, true]) {
  for (const dll of [false, true]) {
    const bytes = Buffer.alloc(1024);
    const pe = 0x80;
    const optional = pe + 24;
    const section = optional + 0xe0;
    const filename = `rea-windows-ce-${thumb ? "thumb" : "arm"}.${dll ? "dll" : "exe"}`;
    bytes.write("MZ");
    bytes.writeUInt32LE(pe, 0x3c);
    bytes.write("PE\0\0", pe, "binary");
    bytes.writeUInt16LE(thumb ? 0x01c2 : 0x01c0, pe + 4);
    bytes.writeUInt16LE(1, pe + 6);
    bytes.writeUInt16LE(0xe0, pe + 20);
    bytes.writeUInt16LE(dll ? 0x2102 : 0x0102, pe + 22);
    bytes.writeUInt16LE(0x10b, optional);
    bytes.writeUInt32LE(0x200, optional + 4);
    bytes.writeUInt32LE(dll ? 0 : thumb ? 0x1001 : 0x1000, optional + 16);
    bytes.writeUInt32LE(0x1000, optional + 20);
    bytes.writeUInt32LE(0x10000000, optional + 28);
    bytes.writeUInt32LE(0x1000, optional + 32);
    bytes.writeUInt32LE(0x200, optional + 36);
    bytes.writeUInt16LE(4, optional + 40);
    bytes.writeUInt16LE(4, optional + 48);
    bytes.writeUInt32LE(0x2000, optional + 56);
    bytes.writeUInt32LE(0x200, optional + 60);
    bytes.writeUInt16LE(9, optional + 68);
    bytes.writeUInt32LE(0x100000, optional + 72);
    bytes.writeUInt32LE(0x1000, optional + 76);
    bytes.writeUInt32LE(0x100000, optional + 80);
    bytes.writeUInt32LE(0x1000, optional + 84);
    bytes.writeUInt32LE(16, optional + 92);
    bytes.writeUInt32LE(0x1100, optional + 96);
    bytes.writeUInt32LE(0x90, optional + 100);
    bytes.write(".text", section);
    bytes.writeUInt32LE(0x200, section + 8);
    bytes.writeUInt32LE(0x1000, section + 12);
    bytes.writeUInt32LE(0x200, section + 16);
    bytes.writeUInt32LE(0x200, section + 20);
    bytes.writeUInt32LE(0x60000020, section + 36);
    if (thumb) {
      // Thumb-1: save LR, BL CeAnswer, add one, return (43).
      bytes.set(
        [0x10, 0xb5, 0x00, 0xf0, 0x0d, 0xf8, 0x01, 0x30, 0x10, 0xbd],
        0x200,
      );
      bytes.set([0x2a, 0x20, 0x70, 0x47], 0x220);
    } else {
      for (const [i, word] of [
        0xe92d4010, 0xeb000005, 0xe2800001, 0xe8bd8010,
      ].entries())
        bytes.writeUInt32LE(word, 0x200 + i * 4);
      bytes.writeUInt32LE(0xe3a0002a, 0x220);
      bytes.writeUInt32LE(0xe12fff1e, 0x224);
    }
    // Export both functions so EXE and DLL discovery does not need a symbol file.
    bytes.writeUInt32LE(0x1160, 0x30c);
    bytes.writeUInt32LE(1, 0x310);
    bytes.writeUInt32LE(2, 0x314);
    bytes.writeUInt32LE(2, 0x318);
    bytes.writeUInt32LE(0x1128, 0x31c);
    bytes.writeUInt32LE(0x1130, 0x320);
    bytes.writeUInt32LE(0x1138, 0x324);
    bytes.writeUInt32LE(thumb ? 0x1001 : 0x1000, 0x328);
    bytes.writeUInt32LE(thumb ? 0x1021 : 0x1020, 0x32c);
    bytes.writeUInt32LE(0x1140, 0x330);
    bytes.writeUInt32LE(0x1150, 0x334);
    bytes.writeUInt16LE(1, 0x338);
    bytes.writeUInt16LE(0, 0x33a);
    bytes.write("CeAnswer\0", 0x340);
    bytes.write("CeCaller\0", 0x350);
    bytes.write("rea-ce-fixture\0", 0x360);
    const path = new URL(filename, output);
    await writeFile(path, bytes);
    console.log(fileURLToPath(path));
  }
}
