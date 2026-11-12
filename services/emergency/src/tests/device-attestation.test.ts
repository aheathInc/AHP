import {test} from 'node:test';
import assert from 'node:assert/strict';
import {signEmergencyDeviceReport,verifyEmergencyDeviceReport} from '@a-health/http';
const secret='synthetic-secret-for-device-report-signatures';const now=Date.now();
const body={device_alert_id:'synthetic',location:{lat:-6.8,lng:39.28},omitted:undefined};
test('device report signatures survive JSON transport without trusting arbitrary profile links',()=>{
 const header=signEmergencyDeviceReport(secret,body,now);
 assert.equal(verifyEmergencyDeviceReport(secret,JSON.parse(JSON.stringify(body)),header,now),true);
 assert.equal(verifyEmergencyDeviceReport(secret,{...body,patient_profile_id:'other-patient'},header,now),false);
 assert.equal(verifyEmergencyDeviceReport('wrong-key',body,header,now),false);
});
test('expired, future and malformed device attestations fail closed',()=>{
 const header=signEmergencyDeviceReport(secret,body,now);
 assert.equal(verifyEmergencyDeviceReport(secret,body,header,now+5*60000+1),false);
 assert.equal(verifyEmergencyDeviceReport(secret,body,header,now-5*60000-1),false);
 for(const value of [undefined,'bad','v1:1:abcdef'])assert.equal(verifyEmergencyDeviceReport(secret,body,value,now),false);
 assert.equal(verifyEmergencyDeviceReport(secret,undefined,header,now),false);
});
