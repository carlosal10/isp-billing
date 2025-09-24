from pathlib import Path
path = Path('server/routes/stripeWebhook.js')
text = path.read_text(encoding='utf-8')
old = """        await applyBandwidth(payment.customer, payment.plan);"""
new = """        try {\n          const customerDoc = payment.customer;\n          const planDoc = payment.plan;\n          if (customerDoc) {\n            customerDoc.status = 'active';\n            if (typeof customerDoc.save === 'function') {\n              await customerDoc.save().catch(() => {});\n            }\n            if (customerDoc.connectionType === 'static') {\n              await enableCustomerQueue(customerDoc, planDoc).catch(() => {});\n            } else {\n              await applyCustomerQueue(customerDoc, planDoc).catch(() => {});\n            }\n          }\n        } catch (err) {\n          console.warn('[stripe-webhook] queue sync failed:', err?.message || err);\n        }"""
if old in text:
    text = text.replace(old, new)
path.write_text(text, encoding='utf-8')
