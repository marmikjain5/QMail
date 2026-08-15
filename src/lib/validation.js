import { z } from "zod";

import { AppError } from "./errors.js";

export function validate(schema, payload) {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new AppError(result.error.issues.map((issue) => issue.message).join(", "), 400);
  }
  return result.data;
}

export const reserveKeySchema = z.object({
  sourceClientCode: z.enum(["client1", "client2"]),
  targetClientCode: z.enum(["client1", "client2"]),
  mode: z.enum(["STANDARD", "QUANTUM_AES", "QUANTUM_OTP"]),
  requestedBytes: z.number().int().positive().optional(),
  purpose: z.string().min(1).max(100).optional()
});

export const retrieveKeySchema = z.object({
  ownerClientCode: z.enum(["client1", "client2"]),
  keyId: z.string().min(1)
});

export const composeSchema = z.object({
  senderClientCode: z.enum(["client1", "client2"]),
  recipientClientCode: z.enum(["client1", "client2"]),
  subject: z.string().min(1).max(250),
  body: z.string().min(1),
  securityLevel: z.enum(["STANDARD", "QUANTUM_AES", "QUANTUM_OTP"]),
  transportMode: z.enum(["INTERNAL", "GMAIL"]).default("INTERNAL")
});

export const decryptSchema = z.object({
  viewerClientCode: z.enum(["client1", "client2"]),
  messageId: z.string().min(1)
});
