const SECRET_KEYS = new Set([
  'JWT_SECRET',
  'MPESA_CONSUMER_SECRET',
  'MPESA_PASSKEY',
  'STRIPE_SECRET_KEY',
  'PAYPAL_CLIENT_SECRET',
]);

function hasValue(value) {
  return String(value || '').trim().length > 0;
}

function isUrl(value) {
  if (!hasValue(value)) return false;
  try {
    new URL(String(value));
    return true;
  } catch (error) {
    return false;
  }
}

function issue(severity, key, message) {
  return { severity, key, message };
}

function sanitizedValue(key, value) {
  if (!hasValue(value)) return '<missing>';
  if (SECRET_KEYS.has(key)) return `<set:${String(value).length} chars>`;
  if (key === 'MONGO_URI' || key === 'MONGODB_URI') return '<set>';
  return String(value);
}

function normalizeEnv(env = process.env) {
  const mongoUri = env.MONGO_URI || env.MONGODB_URI;
  return {
    ...env,
    ...(mongoUri ? { MONGO_URI: mongoUri, MONGODB_URI: mongoUri } : {}),
  };
}

function getEnvReport(env = process.env) {
  const normalized = normalizeEnv(env);
  const production = normalized.NODE_ENV === 'production';
  const findings = [];

  if (!hasValue(normalized.MONGO_URI)) {
    findings.push(issue('error', 'MONGO_URI', 'MONGO_URI or MONGODB_URI is required.'));
  }

  if (!hasValue(normalized.JWT_SECRET)) {
    findings.push(issue('error', 'JWT_SECRET', 'JWT_SECRET is required.'));
  } else if (String(normalized.JWT_SECRET).length < 10) {
    findings.push(issue('error', 'JWT_SECRET', 'JWT_SECRET must be at least 10 characters.'));
  } else if (production && String(normalized.JWT_SECRET).length < 32) {
    findings.push(issue('warning', 'JWT_SECRET', 'Production JWT_SECRET should be at least 32 characters.'));
  }

  if (hasValue(normalized.MPESA_ENV) && !['sandbox', 'production'].includes(normalized.MPESA_ENV)) {
    findings.push(issue('error', 'MPESA_ENV', 'MPESA_ENV must be sandbox or production when provided.'));
  }

  ['CLIENT_URL', 'PUBLIC_BASE_URL', 'MPESA_CALLBACK_URL'].forEach((key) => {
    if (hasValue(normalized[key]) && !isUrl(normalized[key])) {
      findings.push(issue('error', key, `${key} must be a valid URL when provided.`));
    }
  });

  if (production && !hasValue(normalized.CLIENT_URL) && !hasValue(normalized.CLIENT_ORIGINS)) {
    findings.push(issue('warning', 'CLIENT_URL', 'Production should set CLIENT_URL or CLIENT_ORIGINS for CORS.'));
  }

  const errors = findings.filter((item) => item.severity === 'error');
  const warnings = findings.filter((item) => item.severity === 'warning');
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    normalized,
    sanitized: {
      MONGO_URI: sanitizedValue('MONGO_URI', normalized.MONGO_URI),
      JWT_SECRET: sanitizedValue('JWT_SECRET', normalized.JWT_SECRET),
      MPESA_ENV: sanitizedValue('MPESA_ENV', normalized.MPESA_ENV),
      CLIENT_URL: sanitizedValue('CLIENT_URL', normalized.CLIENT_URL),
      PUBLIC_BASE_URL: sanitizedValue('PUBLIC_BASE_URL', normalized.PUBLIC_BASE_URL),
      MPESA_CALLBACK_URL: sanitizedValue('MPESA_CALLBACK_URL', normalized.MPESA_CALLBACK_URL),
    },
  };
}

function validateEnv(env = process.env) {
  const report = getEnvReport(env);
  const warnings = [...report.errors, ...report.warnings];
  if (warnings.length) {
    console.warn(
      '[config] env validation warnings:',
      warnings.map((item) => `${item.key}: ${item.message}`).join('; ')
    );
  }
  if (env && typeof env === 'object' && report.normalized.MONGO_URI) {
    env.MONGO_URI = report.normalized.MONGO_URI;
    env.MONGODB_URI = report.normalized.MONGODB_URI;
  }
  return report.normalized;
}

module.exports = {
  getEnvReport,
  normalizeEnv,
  sanitizedValue,
  validateEnv,
};
