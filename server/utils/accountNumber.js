const MAX_PREFIX_LEN = 4;
const MAX_SUFFIX_LEN = 8;

function tokenize(value) {
  return String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .split(/[\s,/_\\.-]+/)
    .map((part) => part.replace(/[^A-Za-z0-9]/g, ''))
    .filter(Boolean);
}

function deriveAccountCode(source) {
  const tokens = tokenize(source);
  if (!tokens.length) return 'CUST';

  const letters = [];
  const numericOrMixed = [];

  for (const token of tokens) {
    if (/\d/.test(token)) {
      numericOrMixed.push(token.toUpperCase());
    } else {
      letters.push(token[0].toUpperCase());
    }
  }

  let prefix = letters.join('').slice(0, MAX_PREFIX_LEN);

  if (!prefix) {
    if (numericOrMixed.length) {
      prefix = numericOrMixed.shift().toUpperCase().slice(0, MAX_PREFIX_LEN);
    } else {
      prefix = tokens.join('').toUpperCase().slice(0, MAX_PREFIX_LEN);
    }
  }

  const suffix = numericOrMixed.join('').slice(0, MAX_SUFFIX_LEN);
  const combined = `${prefix}${suffix}`.replace(/[^A-Z0-9]/g, '').slice(0, MAX_PREFIX_LEN + MAX_SUFFIX_LEN);

  if (combined) return combined;
  return tokens.join('').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, MAX_PREFIX_LEN + MAX_SUFFIX_LEN) || 'CUST';
}

// Derive a full account code from address using full address tokens (for tenants with no prefix)
// This function concatenates all alphanumeric tokens from the source string in uppercase, preserving their full contents.
// No abbreviation is used here, so that account numbers reflect the full address name segments.
function deriveFullAddressCode(source) {
  const tokens = tokenize(source);
  if (!tokens.length) return 'CUST';
  // Join tokens and remove non-alphanumeric characters. Upper-case for consistency.
  return tokens.join('').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

module.exports = { deriveAccountCode, deriveFullAddressCode };
