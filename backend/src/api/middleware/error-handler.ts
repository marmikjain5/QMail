import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  AuthTagVerificationError,
  AttachmentIntegrityError,
  InsufficientKeyMaterialError,
  KeyAlreadyConsumedError,
  KeyNotFoundError,
  OtpIntegrityError,
  QkmUnavailableError,
} from '../../modules/crypto/errors.js';
import { ZodError } from 'zod';

export async function errorHandler(
  error: Error & { statusCode?: number; validation?: unknown },
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Specific error types
  if (error instanceof AuthTagVerificationError) {
    return reply.status(422).send({
      error: 'AUTHENTICATION_FAILED',
      code: error.code,
      message: error.message,
      userMessage: '⚠️ Message authentication failed. The content may have been tampered with.',
      tamperingDetected: true,
    });
  }

  if (error instanceof OtpIntegrityError) {
    return reply.status(422).send({
      error: 'OTP_INTEGRITY_FAILED',
      code: error.code,
      message: error.message,
      userMessage: '⚠️ OTP integrity check failed. The ciphertext may be corrupted.',
      tamperingDetected: true,
    });
  }

  if (error instanceof AttachmentIntegrityError) {
    return reply.status(422).send({
      error: 'ATTACHMENT_INTEGRITY_MISMATCH',
      code: error.code,
      message: error.message,
      userMessage: `🔴 Attachment integrity check failed. SHA-256 hash does not match the blockchain record.`,
      expectedHash: error.expectedHash,
      actualHash: error.actualHash,
    });
  }

  if (error instanceof InsufficientKeyMaterialError) {
    return reply.status(409).send({
      error: 'INSUFFICIENT_KEY_MATERIAL',
      code: error.code,
      message: error.message,
      userMessage:
        `Insufficient OTP key material. Available: ${error.availableBytes} bytes, ` +
        `Required: ${error.requiredBytes} bytes. Switch to Level 2 (Quantum-AES) or wait for pool replenishment.`,
      availableBytes: error.availableBytes,
      requiredBytes: error.requiredBytes,
      suggestedAction: 'SWITCH_TO_LEVEL_2',
    });
  }

  if (error instanceof KeyAlreadyConsumedError) {
    return reply.status(409).send({
      error: 'KEY_ALREADY_CONSUMED',
      code: error.code,
      message: error.message,
      userMessage: '🔴 Security violation: This key has already been used. OTP key reuse is strictly forbidden.',
    });
  }

  if (error instanceof KeyNotFoundError) {
    return reply.status(404).send({
      error: 'KEY_NOT_FOUND',
      code: error.code,
      message: error.message,
    });
  }

  if (error instanceof QkmUnavailableError) {
    return reply.status(503).send({
      error: 'QKM_UNAVAILABLE',
      code: error.code,
      message: error.message,
      userMessage: 'Quantum Key Manager is unavailable. Cannot establish encrypted session. Message was NOT sent.',
    });
  }

  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: 'VALIDATION_ERROR',
      message: 'Invalid request data',
      details: error.flatten(),
    });
  }

  // HTTP status from error object
  const statusCode = error.statusCode ?? 500;

  if (statusCode >= 500) {
    console.error(`[ErrorHandler] ${request.method} ${request.url}:`, error);
  }

  return reply.status(statusCode).send({
    error: statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
    message: statusCode >= 500
      ? 'An unexpected error occurred. Please try again.'
      : error.message,
  });
}
