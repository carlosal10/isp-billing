'use strict';
const { z } = require('zod');
const { isIP } = require('node:net');
const id = z.string().regex(/^[a-f0-9]{24}$/i);
const text = z.string().trim().min(1).max(128).regex(/^[^\x00-\x1f\x7f]+$/);
const schema = z.object({
  customerId: id, routerId: id, accessType: z.enum(['pppoe', 'static', 'hotspot']),
  authenticationMode: z.literal('local').default('local'),
  username: text.optional(), password: z.string().min(8).max(128).optional(),
  pppProfile: text.optional(), hotspotProfile: text.optional(),
  ipAddress: z.string().refine(v => isIP(v) === 4).optional(),
  macAddress: z.string().regex(/^(?:[a-f0-9]{2}:){5}[a-f0-9]{2}$/i).optional(),
  fupPolicyId: id.nullable().optional(),
}).strict().superRefine((v, ctx) => {
  const required = v.accessType === 'static' ? ['ipAddress'] : ['username', 'password', v.accessType === 'pppoe' ? 'pppProfile' : 'hotspotProfile'];
  for (const field of required) if (!v[field]) ctx.addIssue({ code: 'custom', path: [field], message: 'Required' });
  if (v.accessType === 'static' && (v.password || v.username)) ctx.addIssue({ code: 'custom', message: 'Static assignments do not accept login credentials' });
});
function parseAssignment(body) {
  const result = schema.safeParse(body);
  if (!result.success) throw Object.assign(new Error('Enter a valid customer, router and service settings. Local PPPoE/hotspot requires a username, password and profile; static IP requires one IPv4 address.'), { statusCode: 400 });
  return result.data;
}
module.exports = { parseAssignment };
