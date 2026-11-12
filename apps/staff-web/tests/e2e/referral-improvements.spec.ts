import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

test('keeps referral outcomes separate, requires a decision and sends the displayed version',async({page},testInfo)=>{
  test.skip(!process.env.AHP_REFERRAL_UI_FIXTURE,'Requires a local synthetic clinician login. Referral API responses are controlled UI fixtures.');
  if(!/^http:\/\/(localhost|127\.0\.0\.1):3000$/.test(process.env.PLAYWRIGHT_BASE_URL??'http://localhost:3000'))throw Error('Local synthetic UI acceptance only');
  const {doctor}=JSON.parse(readFileSync(process.env.AHP_REFERRAL_UI_FIXTURE!,'utf8'));
  const make=(id:string,name:string)=>({id,status:'in_care',version:7,priority:'urgent',purpose:name,clinical_summary:'Synthetic handoff for interface verification',patient_reference:'synthetic-patient',consultation_id:'synthetic-case',source:{facility:{id:'source',name:'Synthetic source'},department:null,clinician:null},destination:{facility:{id:'dest',name:'Synthetic destination'},department:null,clinician:null},created_at:'2026-11-12T09:00:00Z',updated_at:'2026-11-12T09:00:00Z',expires_at:'2026-11-25T09:00:00Z',outcome:null});
  const rows=[make('synthetic-a','Synthetic referral A'),make('synthetic-b','Synthetic referral B')];
  let completion:Record<string,unknown>|undefined;
  await page.route('**/bff/referrals**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(route.request().method()==='POST'){
      expect(path).toBe('/bff/referrals/synthetic-b/complete');
      completion=route.request().postDataJSON();
      rows[1].status='completed';
      await route.fulfill({json:rows[1]});return;
    }
    await route.fulfill({json:{data:path==='/bff/referrals/inbox'?rows:[],meta:{next_cursor:null}}});
  });
  await page.route('**/bff/facilities**',route=>route.fulfill({json:{data:[],meta:{next_cursor:null}}}));
  await page.goto('/login');await page.getByLabel('Email').fill(doctor.email);await page.getByLabel('Password').fill(doctor.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/doctor/queue');
  await page.goto('/doctor/referrals');
  await expect(page.getByText('Synthetic referral A',{exact:true})).toBeVisible();
  await expect(page.locator('#referral-outcome-synthetic-a')).toHaveValue('');
  await expect(page.locator('#referral-outcome-synthetic-b')).toHaveValue('');
  const completionButtons=page.getByRole('button',{name:'Complete and send feedback',exact:true});await expect(completionButtons.nth(0)).toBeDisabled();await expect(completionButtons.nth(1)).toBeDisabled();
  await page.locator('#referral-follow-up-synthetic-a').fill('Synthetic follow-up A');
  await page.locator('#referral-patient-instructions-synthetic-a').fill('Synthetic patient A instructions');
  await expect(page.locator('#referral-follow-up-synthetic-b')).toHaveValue('');
  await expect(page.locator('#referral-patient-instructions-synthetic-b')).toHaveValue('');
  await page.locator('#referral-outcome-synthetic-b').selectOption('unable_to_complete');
  await page.locator('#referral-patient-instructions-synthetic-b').fill('Synthetic patient B instructions');
  await page.screenshot({path:testInfo.outputPath('referral-desktop.png'),fullPage:true});
  page.once('dialog',dialog=>dialog.accept());await completionButtons.nth(1).click();
  await expect.poll(()=>completion).toEqual({outcome_status:'unable_to_complete',patient_instructions:'Synthetic patient B instructions',base_version:7});
  await expect(page.locator('#referral-follow-up-synthetic-a')).toHaveValue('Synthetic follow-up A');
  await page.getByLabel('Search loaded referrals').fill('no matching referral');
  await expect(page.getByText('No incoming referrals match these filters.',{exact:true})).toBeVisible();
  await page.getByLabel('Search loaded referrals').fill('');
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('heading',{name:'Track referrals',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath('referral-mobile.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
