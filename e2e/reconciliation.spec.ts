import { expect,test } from '@playwright/test';
import { today } from '../src/lib/finance';

test('Home purchase shortcuts select categories and allow correcting a backdated manual purchase',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Open local preview'}).click();
 await page.getByRole('button',{name:'Add Gas purchase',exact:true}).click();
 await expect(page.getByRole('combobox',{name:'Category',exact:true})).toHaveValue('gas');
 await page.getByLabel('Merchant',{exact:true}).fill('Fuel stop');
 await page.getByLabel('Amount ($)').fill('32');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeHidden();
 await page.getByRole('button',{name:'View Gas purchases',exact:true}).click();
 await page.getByRole('button',{name:/Fuel stop.*\$32\.00/}).click();
 await page.getByLabel('Amount ($)').fill('33');
 await page.getByLabel('Date',{exact:true}).fill('2026-03-01');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.getByRole('button',{name:/Fuel stop.*\$33\.00/})).toBeHidden();
 await page.getByRole('button',{name:'All time',exact:true}).click();
 await expect(page.getByRole('button',{name:/Fuel stop.*\$33\.00/})).toBeVisible();
 await page.getByRole('button',{name:'Bank imports',exact:true}).click();
 await expect(page.getByText('Fuel stop',{exact:true})).toBeHidden();
});

test('phone purchase sheet keeps entry and save reachable',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('/');await page.getByRole('button',{name:'Open local preview'}).click();
 await page.getByRole('button',{name:'Add purchase',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveClass(/purchase-sheet/);
 await page.screenshot({path:'test-results/purchase-sheet-phone.png'});
 await page.getByLabel('Merchant',{exact:true}).fill('A long merchant name for a household purchase');
 await page.getByLabel('Amount ($)').fill('13.75');
 await page.getByRole('combobox',{name:'Category',exact:true}).selectOption('household');
 await page.setViewportSize({width:390,height:500});
 await expect.poll(()=>page.getByRole('dialog').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeHidden();
});


test('split exclusion checkbox persists when a transaction is edited',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Open local preview'}).click();
 await page.getByRole('button',{name:'Add purchase',exact:true}).click();
 await page.getByLabel('Merchant',{exact:true}).fill('Partly excluded purchase');
 await page.getByLabel('Amount ($)').fill('100');
 await page.getByRole('button',{name:'Split transaction',exact:true}).click();
 await page.getByRole('combobox',{name:'Split 1 category'}).selectOption('household');
 await page.getByRole('combobox',{name:'Split 2 category'}).selectOption('gas');
 await page.getByRole('spinbutton',{name:'Split 1 amount'}).fill('65');
 await page.getByRole('spinbutton',{name:'Split 2 amount'}).fill('35');
 await page.getByRole('checkbox',{name:'Exclude split 2 from budget'}).check();
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeHidden();
 await page.getByRole('button',{name:'Transactions',exact:true}).first().click();
 const row=page.locator('.transaction-row').filter({hasText:'Partly excluded purchase'});
 await expect(row).toContainText('$100.00');
 await row.click();
 await expect(page.getByRole('checkbox',{name:'Exclude split 1 from budget'})).not.toBeChecked();
 await expect(page.getByRole('checkbox',{name:'Exclude split 2 from budget'})).toBeChecked();
 await page.getByRole('checkbox',{name:'Exclude split 2 from budget'}).uncheck();
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await row.click();
 await expect(page.getByRole('checkbox',{name:'Exclude split 2 from budget'})).not.toBeChecked();
});
 
test('split refunds show positive inputs and keep negative totals when reopened',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Open local preview'}).click();
 await page.getByRole('button',{name:'Add purchase',exact:true}).click();
 await page.getByLabel('Merchant',{exact:true}).fill('Split refund regression');
 await page.getByLabel('Amount ($)').fill('55');
 await page.getByRole('button',{name:'Spent',exact:true}).click();
 await page.getByRole('button',{name:'Split transaction',exact:true}).click();
 await page.getByRole('combobox',{name:'Split 1 category'}).selectOption('household');
 await page.getByRole('combobox',{name:'Split 2 category'}).selectOption('gas');
 await page.getByRole('spinbutton',{name:'Split 1 amount'}).fill('25');
 await page.getByRole('spinbutton',{name:'Split 2 amount'}).fill('30');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeHidden();
 await page.getByRole('button',{name:'Transactions',exact:true}).first().click();
 const row=page.locator('.transaction-row').filter({hasText:'Split refund regression'});
 await expect(row).toContainText('+$55.00');
 await row.click();
 await expect(page.getByRole('button',{name:'Added',exact:true})).toBeVisible();
 await expect(page.getByLabel('Amount ($)')).toHaveValue('55');
 await expect(page.getByRole('spinbutton',{name:'Split 1 amount'})).toHaveValue('25');
 await expect(page.getByRole('spinbutton',{name:'Split 2 amount'})).toHaveValue('30');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(row).toContainText('+$55.00');
});

for(const manualFirst of [true,false])test(`bank matching counts once when manual entry is ${manualFirst?'first':'later'}`,async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Open local preview'}).click();
 const enter=async()=>{
  await page.getByRole('button',{name:'Home',exact:true}).first().click();
  await page.getByRole('button',{name:'Add Household & Kids purchase',exact:true}).click();
  await page.getByLabel('Merchant',{exact:true}).fill('The Salvation Army');
  await page.getByLabel('Amount ($)').fill('13.75');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeHidden();
 };
 if(manualFirst)await enter();
 await page.getByRole('button',{name:'Transactions',exact:true}).first().click();
 await page.getByLabel('Import CSV',{exact:true}).setInputFiles({name:'example.csv',mimeType:'text/csv',buffer:Buffer.from(`date,merchant,amount\n${today()},The Salvation Army,13.75\n`)});
 await page.getByLabel('Account label (use the same label for future imports)').fill('Example checking');
 await page.getByRole('button',{name:'Preview import',exact:true}).click();
 await page.getByRole('button',{name:'Import transactions',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeHidden();
 if(!manualFirst){await expect(page.getByText('No likely match found',{exact:true})).toBeVisible();await enter();await page.getByRole('button',{name:'Transactions',exact:true}).first().click();await page.getByRole('button',{name:'Bank imports',exact:true}).click();}
 await expect(page.getByText('Possible match found',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Match existing purchase',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:/The Salvation Army/}).click();
 await expect(page.getByText('Matched',{exact:true})).toBeVisible();
 await expect(page.getByText('Already recorded',{exact:true})).toBeVisible();
 await page.screenshot({path:`test-results/import-matched-${manualFirst}.png`});
 await page.getByRole('button',{name:'Undo match',exact:true}).click();
 await expect(page.getByText('Not budgeted',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Home',exact:true}).first().click();
 await expect(page.locator('.big-money')).toContainText('$561');
});
