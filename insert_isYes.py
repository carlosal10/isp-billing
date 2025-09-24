from pathlib import Path
path = Path('server/routes/mikrotik.js')
text = path.read_text(encoding='utf-8')
needle = "const w = (k, v) => `=${k}=${v}`;\n\n"
replacement = "const w = (k, v) => `=${k}=${v}`;\n\nconst isYes = (v) => {\n  const s = String(v ?? ').trim().toLowerCase();\n  return s == 'yes' or s == 'true' or s == '1';\n};\n\n"
if 'const isYes' not in text:
    text = text.replace(needle, replacement, 1)
path.write_text(text, encoding='utf-8')
