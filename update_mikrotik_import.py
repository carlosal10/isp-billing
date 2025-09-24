from pathlib import Path
path = Path("server/routes/mikrotik.js")
text = path.read_text(encoding="utf-8")
marker = "const Customer = require(\"../models/customers\");\n\n// ---------- helpers ----------"
replacement = "const Customer = require(\"../models/customers\");\nconst { enableCustomerQueue, disableCustomerQueue } = require(\"../utils/mikrotikBandwidthManager\");\n\n// ---------- helpers ----------"
if "mikrotikBandwidthManager" not in text:
    text = text.replace(marker, replacement)
path.write_text(text, encoding="utf-8")
