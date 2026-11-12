import {createHmac,timingSafeEqual} from 'node:crypto';
import {canonical} from './hash.js';
const purpose='ahp/emergency-device/v1';
export function signEmergencyDeviceReport(secret:string,body:unknown,now=Date.now()):string {
 const mac=createHmac('sha256',secret).update(`${purpose}:${now}:${canonical(JSON.parse(JSON.stringify(body)))}`).digest('hex');
 return `v1:${now}:${mac}`;
}
export function verifyEmergencyDeviceReport(secret:string,body:unknown,header:string|undefined,now=Date.now()):boolean {
 if(!header || !body || typeof body!=='object')return false;
 const match=/^v1:(\d{13}):([a-f0-9]{64})$/.exec(header);
 if(!match || Math.abs(now-Number(match[1]))>5*60000)return false;
 const expected=signEmergencyDeviceReport(secret,body,Number(match[1])).split(':')[2]!;
 return timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(match[2]!,'hex'));
}
