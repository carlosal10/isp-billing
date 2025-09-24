from pathlib import Path
path = Path("server/routes/mikrotik.js")
text = path.read_text(encoding="utf-8")
old = "const isYes = (v) => {\n  const s = String(v ?? ').trim().toLowerCase();\n  return s == 'yes' or s == 'true' or s == '1';\n};\n\n"
new = "const isYes = (v) => {\n  const s = String(v ?? '').trim().toLowerCase();\n  return s === 'yes' || s === 'true' || s === '1';\n};\n\n"
text = text.replace(old, new)
path.write_text(text, encoding="utf-8")
