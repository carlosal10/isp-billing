'use strict';

const REDACTED = '[redacted]';
const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_MAX_ARRAY_LENGTH = 100;
const DEFAULT_MAX_DEPTH_LABEL = '[max-depth]';
const SENSITIVE_KEY_PATTERN =
  /(password|passcode|passwd|pwd|token|secret|authorization|cookie|pin|pinhash|api[-_]?key|private[-_]?key|passkey|client[-_]?secret|consumer[-_]?secret|signature|webhook[-_]?secret|keyhash|refresh[-_]?token|access[-_]?token|session)/i;

function compactString(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function maskText(text, { prefix = 2, suffix = 3, minMasked = 4, mask = '*' } = {}) {
  const normalized = compactString(text);
  if (!normalized) return null;

  if (normalized.length <= prefix + suffix) {
    if (normalized.length <= 2) return mask.repeat(Math.max(normalized.length, 1));
    return `${normalized.slice(0, 1)}${mask.repeat(Math.max(normalized.length - 2, 1))}${normalized.slice(-1)}`;
  }

  const maskedLength = Math.max(normalized.length - prefix - suffix, minMasked);
  const suffixText = suffix > 0 ? normalized.slice(-suffix) : '';
  return `${normalized.slice(0, prefix)}${mask.repeat(maskedLength)}${suffixText}`;
}

function maskIdentifier(value, options = {}) {
  return maskText(value, options);
}

function maskEmail(value) {
  const text = compactString(value);
  if (!text || !text.includes('@')) return maskIdentifier(text, { prefix: 1, suffix: 2 });

  const [localPart, ...domainParts] = text.split('@');
  const domain = domainParts.join('@');
  if (!localPart || !domain) return maskIdentifier(text, { prefix: 1, suffix: 2 });

  return `${maskText(localPart, { prefix: 1, suffix: 0, minMasked: 3 })}@${domain}`;
}

function maskPhone(value) {
  const text = compactString(value);
  if (!text) return null;

  const digits = text.replace(/\D/g, '');
  if (digits.length < 7) return maskIdentifier(text, { prefix: 1, suffix: 2 });

  const prefixDigits = text.startsWith('+') && digits.length >= 10 ? digits.slice(0, 3) : digits.slice(0, 2);
  const prefix = text.startsWith('+') ? `+${prefixDigits}` : prefixDigits;
  const suffix = digits.slice(-3);
  const visiblePrefixDigits = prefixDigits.length;
  const maskedLength = Math.max(digits.length - visiblePrefixDigits - suffix.length, 4);
  return `${prefix}${'*'.repeat(maskedLength)}${suffix}`;
}

function maskAccountNumber(value) {
  return maskIdentifier(value, { prefix: 3, suffix: 2, minMasked: 4 });
}

function maskTransactionId(value) {
  return maskIdentifier(value, { prefix: 4, suffix: 4, minMasked: 6 });
}

function maskIpAddress(value) {
  const text = compactString(value);
  if (!text) return null;

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) {
    const parts = text.split('.');
    return `${parts.slice(0, 3).join('.')}.0/24`;
  }

  if (text.includes(':')) {
    const parts = text.split(':').filter(Boolean);
    return `${parts.slice(0, 2).join(':')}::/64`;
  }

  return maskIdentifier(text, { prefix: 2, suffix: 2 });
}

function redactObject(value, options = {}, depth = 0) {
  const {
    maxDepth = DEFAULT_MAX_DEPTH,
    maxArrayLength = DEFAULT_MAX_ARRAY_LENGTH,
    maxDepthLabel = DEFAULT_MAX_DEPTH_LABEL,
    redactedLabel = REDACTED,
    sensitiveKeyPattern = SENSITIVE_KEY_PATTERN,
  } = options;

  if (value == null) return value;
  if (depth > maxDepth) return maxDepthLabel;
  if (Array.isArray(value)) {
    return value.slice(0, maxArrayLength).map((entry) => redactObject(entry, options, depth + 1));
  }
  if (value instanceof Date) return value;
  if (typeof value !== 'object') return value;

  const safe = {};
  for (const [key, entry] of Object.entries(value)) {
    if (sensitiveKeyPattern.test(String(key))) {
      safe[key] = redactedLabel;
    } else {
      safe[key] = redactObject(entry, options, depth + 1);
    }
  }
  return safe;
}

module.exports = {
  DEFAULT_MAX_ARRAY_LENGTH,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_DEPTH_LABEL,
  REDACTED,
  SENSITIVE_KEY_PATTERN,
  maskAccountNumber,
  maskEmail,
  maskIdentifier,
  maskIpAddress,
  maskPhone,
  maskTransactionId,
  redactObject,
};
