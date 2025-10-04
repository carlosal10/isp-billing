const { z } = require('zod');

const EnvSchema = z.object({
  MONGO_URI: z.string().min(1),
  JWT_SECRET: z.string().min(10),
  MPESA_ENV: z.enum(['sandbox','production']).optional(),
  CLIENT_URL: z.string().url().optional(),
  PUBLIC_BASE_URL: z.string().url().optional(),
});

function validateEnv(env = process.env) {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    console.warn('[config] env validation warnings:', parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return parsed.success ? parsed.data : env;
}

module.exports = { validateEnv };

