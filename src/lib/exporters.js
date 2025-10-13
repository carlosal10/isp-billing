// Lightweight exporters for XLSX (SheetJS) with CSV fallback.
// Usage: exportRows({ rows, headers, filename, sheetName })

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toCSV({ rows, headers }) {
  const head = headers.map(h => `"${String(h).replace(/"/g,'""')}"`).join(",");
  const body = rows.map(r =>
    headers.map(h => `"${String(r[h] ?? "").replace(/"/g,'""')}"`).join(",")
  ).join("\n");
  return `${head}\n${body}`;
}

async function loadXLSXRuntime() {
  const scope = (typeof window !== "undefined" && window)
    
    || (typeof global !== "undefined" && global)
    || undefined;

  if (scope && scope.XLSX) return scope.XLSX;

  try {
    const mod = await import(/* webpackIgnore: true */ "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js");
    const lib = mod && (mod.XLSX || mod.default);
    if (lib) {
      if (scope) scope.XLSX = lib;
      return lib;
    }
  } catch (err) {
    console.warn("XLSX dynamic load failed; falling back to CSV.", err);
  }
  return null;
}

async function tryXLSX({ rows, headers, filename, sheetName }) {
  try {
    const XLSX = await loadXLSXRuntime();
    if (!XLSX || !XLSX.utils) return false;
    const aoa = [
      headers,
      ...rows.map(r => headers.map(h => r[h] ?? "")),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName || "Sheet1");
    const wbout = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    downloadBlob(new Blob([wbout], { type: "application/octet-stream" }), filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
    return true;
  } catch (e) {
    // xlsx not installed or dynamic import blocked
    console.warn("XLSX export failed, falling back to CSV:", e);
    return false;
  }
}

export async function exportRows({ rows, headers, filename, sheetName }) {
  if (!Array.isArray(rows) || rows.length === 0) return;

  // 1) Try XLSX
  const ok = await tryXLSX({ rows, headers, filename, sheetName });
  if (ok) return;

  // 2) Fallback to CSV
  const csv = toCSV({ rows, headers });
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), filename.endsWith(".csv") ? filename : `${filename}.csv`);
}

export function exportRowsCSV({ rows, headers, filename }) {
  const csv = toCSV({ rows, headers });
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), filename.endsWith(".csv") ? filename : `${filename}.csv`);
}



