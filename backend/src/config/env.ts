import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z
    .string()
    .url()
    .default('postgresql://qumail:qumail@localhost:5432/qumail'),

  // Auth
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters')
    .default('dev_secret_please_change_in_production_minimum_32_chars'),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_REDIRECT_URI: z
    .string()
    .url()
    .default('http://localhost:3000/api/auth/google/callback'),

  // Microsoft OAuth
  MICROSOFT_CLIENT_ID: z.string().default(''),
  MICROSOFT_CLIENT_SECRET: z.string().default(''),
  MICROSOFT_TENANT_ID: z.string().default('common'),
  MICROSOFT_REDIRECT_URI: z
    .string()
    .url()
    .default('http://localhost:3000/api/auth/microsoft/callback'),

  // Pinata IPFS
  PINATA_JWT: z.string().default(''),

  // Blockchain
  BLOCKCHAIN_RPC_URL: z.string().url().default('http://127.0.0.1:8545'),
  REGISTRY_CONTRACT_ADDRESS: z.string().default(''),
  REGISTRY_DEPLOYER_PRIVATE_KEY: z.string().default(''),

  // ML sidecar
  ML_SIDECAR_URL: z.string().url().default('http://localhost:8001'),

  // Quantum Key Manager
  QKM_INITIAL_POOL_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024), // 10 MB

  // Frontend
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
});

type Config = z.infer<typeof envSchema>;

function loadConfig(): Config {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    console.error('[Config] ❌ Invalid environment variables:');
    for (const [field, messages] of Object.entries(errors)) {
      console.error(`  ${field}: ${(messages as string[]).join(', ')}`);
    }
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Invalid environment configuration. Refusing to start in production.');
    } else {
      console.warn('[Config] ⚠️  Continuing in development mode with validation errors.');
    }
    // Return with defaults applied where possible
    return envSchema.parse({});
  }

  const cfg = result.data;

  // Warn about missing credentials in development
  const warnings: string[] = [];
  if (!cfg.GOOGLE_CLIENT_ID)
    warnings.push('GOOGLE_CLIENT_ID not set — Gmail integration will be unavailable');
  if (!cfg.MICROSOFT_CLIENT_ID)
    warnings.push('MICROSOFT_CLIENT_ID not set — Microsoft integration will be unavailable');
  if (!cfg.PINATA_JWT)
    warnings.push('PINATA_JWT not set — IPFS will use in-memory mock storage');
  if (!cfg.REGISTRY_CONTRACT_ADDRESS)
    warnings.push(
      'REGISTRY_CONTRACT_ADDRESS not set — blockchain registry will use mock mode',
    );
  if (!cfg.ML_SIDECAR_URL)
    warnings.push('ML_SIDECAR_URL not set — falling back to rule-based anomaly detection');

  if (warnings.length > 0 && cfg.NODE_ENV !== 'test') {
    console.warn('[Config] ℹ️  Development mode notices:');
    warnings.forEach((w) => console.warn(`  • ${w}`));
  }

  return cfg;
}

export const config: Config = loadConfig();
export type { Config };
