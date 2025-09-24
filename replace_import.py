from pathlib import Path
path = Path('server/routes/mikrotik.js')
text = path.read_text(encoding='utf-8')
text = text.replace('const { enableCustomerQueue, disableCustomerQueue } = require("../utils/mikrotikBandwidthManager");', 'const { enableCustomerQueue, disableCustomerQueue, applyCustomerQueue } = require("../utils/mikrotikBandwidthManager");')
path.write_text(text, encoding='utf-8')
