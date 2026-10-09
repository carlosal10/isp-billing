export function sessionState(row, now = Date.now()) {
  if (row.status === 'stopped') return 'stopped';
  const timestamp = Date.parse(row.lastEventAt);
  return row.status === 'stale' || !Number.isFinite(timestamp) || now - timestamp > 900000 ? 'stale' : row.status;
}
export function counterBytes(value) {
  const text = String(value ?? '0');
  return /^\d+$/.test(text) ? BigInt(text) : 0n;
}
