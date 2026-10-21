import { z } from "zod";

export const emulatorEndpointSchema = z.strictObject({
  port: z
    .number()
    .int()
    .min(1)
    .max(65535)
    .describe("QMP TCP port on 127.0.0.1"),
  expected_name: z.string().min(1).max(128).describe("Exact QEMU -name value"),
  expected_uuid: z
    .string()
    .uuid()
    .refine(
      (v) => !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(v),
      "Use a nonzero QEMU -uuid",
    ),
  cpu_index: z.number().int().min(0).max(255).default(0),
});
export const emulatorMemoryInputSchema = emulatorEndpointSchema
  .extend({
    address: z
      .string()
      .regex(/^0x[0-9a-fA-F]{1,8}$/)
      .describe("32-bit guest address, hexadecimal"),
    length: z.number().int().min(1).max(4096),
    address_space: z.enum(["virtual", "physical"]),
  })
  .refine(
    (v) =>
      /^0x[0-9a-fA-F]{1,8}$/.test(v.address) &&
      Number.isSafeInteger(v.length) &&
      BigInt(v.address) + BigInt(v.length) <= 0x100000000n,
    "Read crosses the 32-bit address boundary",
  );
export type EmulatorEndpoint = z.infer<typeof emulatorEndpointSchema>;
export type EmulatorMemoryInput = z.infer<typeof emulatorMemoryInputSchema>;
export const emulatorStateSchema = z.strictObject({
  running: z.boolean(),
  status: z.string().min(1),
});
export const emulatorReportSchema = z.strictObject({
  selection: z.union([emulatorMemoryInputSchema, emulatorEndpointSchema]),
  identity: z.strictObject({
    name: z.string(),
    uuid: z.string().uuid(),
    version: z.string(),
  }),
  before: emulatorStateSchema,
  after: emulatorStateSchema,
  registers: z.string().min(1).max(65536),
  memory: z
    .strictObject({
      address: z.string(),
      address_space: z.enum(["virtual", "physical"]),
      bytes_hex: z.string().regex(/^(?:[0-9a-f]{2}){1,4096}$/),
    })
    .nullable(),
});
