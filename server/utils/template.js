function renderTemplate(template, variables) {
  let result = String(template || '');
  for (const [key, value] of Object.entries(variables || {})) {
    // Replace {{ key }} with value (case-sensitive keys)
    const re = new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*\\}}`, 'g');
    result = result.replace(re, value == null ? '' : String(value));
  }
  return result;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatDateISO(date) {
  try {
    const d = new Date(date);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  } catch {
    return '';
  }
}

module.exports = { renderTemplate, formatDateISO };

