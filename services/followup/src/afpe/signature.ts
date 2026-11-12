import { createHmac, timingSafeEqual } from 'node:crypto';
export function validSignature(secret: string | undefined, timestamp: string, signature: string, raw: Buffer | undefined, now = Date.now()) {
  if (!secret || !raw || !/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(timestamp + '.').update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
