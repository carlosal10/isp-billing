const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
async function login(page) {
 await page.goto('/login');await page.getByLabel('Email',{exact:true}).fill('owner@demo.example');
 await page.getByLabel('Password',{exact:true}).fill('Demo-Only-2026!');
 await page.getByRole('button',{name:'Login',exact:true}).click();await expect(page).not.toHaveURL(/login/);
}
for(const width of [360,1440]) test('fair usage policy creation and editing at '+width+'px',async({page})=>{
 await page.setViewportSize({width,height:1000});await login(page);await page.goto('/routers');
 await page.getByRole('button',{name:'Fair usage',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Fair usage',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'New policy',exact:true}).click();
 await page.getByLabel('Policy name').fill('Browser FUP '+width);
 await page.getByLabel('Data allowance (GB)').fill('25');
 await page.getByLabel('Reduced download').fill('3M');
 await page.getByLabel('Block at (%)').fill('150');
 const dialog=page.getByRole('dialog');
 const result=await new AxeBuilder({page}).include('[role="dialog"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
 expect(result.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
 await page.screenshot({path:'artifacts/ui/fup-form-'+width+'.png',fullPage:true});
 await page.getByRole('button',{name:'Save policy',exact:true}).click();
 await expect(dialog).not.toBeVisible();
 await expect(page.getByRole('heading',{name:'Browser FUP '+width,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Edit Browser FUP '+width,exact:true}).click();
 await expect(page.getByLabel('Reduced download')).toHaveValue('3M');
 await expect(page.getByLabel('Data allowance (GB)')).toHaveValue('25');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.screenshot({path:'artifacts/ui/fup-overview-'+width+'.png',fullPage:true});
});
