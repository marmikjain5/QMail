import crypto from "node:crypto";

import { env } from "./env.js";

const masterKey = () => Buffer.from(env.APP_MASTER_KEY, "hex");

export function encryptSecret(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptSecret(encoded) {
  const payload = Buffer.from(encoded, "base64");
  const iv = payload.subarray(0, 12);
  const authTag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function encryptMessageAes({ keyBase64, plaintext, aad }) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(keyBase64, "base64"), iv);
  if (aad) {
    cipher.setAAD(Buffer.from(aad, "utf8"));
  }
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64")
  };
}

export function decryptMessageAes({ keyBase64, ivBase64, ciphertextBase64, authTagBase64, aad }) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(keyBase64, "base64"),
    Buffer.from(ivBase64, "base64")
  );
  if (aad) {
    decipher.setAAD(Buffer.from(aad, "utf8"));
  }
  decipher.setAuthTag(Buffer.from(authTagBase64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, "base64")),
    decipher.final()
  ]).toString("utf8");
}

export function xorWithOtp({ keyBase64, plaintext }) {
  const plainBuffer = Buffer.from(plaintext, "utf8");
  const keyBuffer = Buffer.from(keyBase64, "base64");
  if (keyBuffer.length < plainBuffer.length) {
    throw new Error("Insufficient OTP key bytes.");
  }
  const out = Buffer.alloc(plainBuffer.length);
  for (let index = 0; index < plainBuffer.length; index += 1) {
    out[index] = plainBuffer[index] ^ keyBuffer[index];
  }
  const hmac = crypto.createHmac("sha256", keyBuffer.subarray(0, 32));
  hmac.update(out);
  return {
    ciphertext: out.toString("base64"),
    integrityTag: hmac.digest("base64"),
    consumedBytes: plainBuffer.length
  };
}

export function decryptOtp({ keyBase64, ciphertextBase64, integrityTag }) {
  const cipherBuffer = Buffer.from(ciphertextBase64, "base64");
  const keyBuffer = Buffer.from(keyBase64, "base64");
  const hmac = crypto.createHmac("sha256", keyBuffer.subarray(0, 32));
  hmac.update(cipherBuffer);
  if (hmac.digest("base64") !== integrityTag) {
    throw new Error("OTP integrity verification failed.");
  }
  if (keyBuffer.length < cipherBuffer.length) {
    throw new Error("Insufficient OTP key bytes.");
  }
  const out = Buffer.alloc(cipherBuffer.length);
  for (let index = 0; index < cipherBuffer.length; index += 1) {
    out[index] = cipherBuffer[index] ^ keyBuffer[index];
  }
  return out.toString("utf8");
}

export function randomKeyBase64(sizeBytes) {
  return crypto.randomBytes(sizeBytes).toString("base64");
}

export function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}
