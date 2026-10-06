import { expect, test, type Page } from '@playwright/test';
import { defaults } from '../src/lib/defaults';
import { addMonths, monthOf, today } from '../src/lib/finance';
import { defaultDashboardPreferences, type DashboardPreferences } from '../src/lib/dashboard-preferences';

const userId = '11111111-1111-1111-1111-111111111111';
const mockUrl = 'https://tcrbcqrsafuckhsknfoy.supabase.co';
function household() {
  const data = defaults();
  const now = new Date().toISOString();
  data.accounts = [
    {id:'checking',name:'Everyday checking',institution:'Example Bank',member:'Luke',mask:'1234',type:'depository',balance_cents:421876,last_synced_at:now,sync_error:null,item_id:'example-bank'},
    {id:'savings',name:'Family savings',institution:'Example Bank',member:'Samantha',mask:'5678',type:'depository',balance_cents:860050,last_synced_at:now,sync_error:null,item_id:'example-bank'},
    {id:'credit',name:'Rewards card',institution:'Example Credit',member:'Luke',mask:'9012',type:'credit',balance_cents:63745,last_synced_at:now,sync_error:null,item_id:'example-card'},
  ];
  data.reservoir = [{id:'reserve',date:today(),amount_cents:3820000,note:'Sample reserve',kind:'initial',created_at:now}];
  data.snap_balances = [{id:'snap',benefit_month:monthOf(today()),balance_cents:28468,observed_at:now,source:'muse'}];
  data.events = [{id:'event',name:'Vehicle registration',date:today(),amount_cents:16500,direction:'outflow',certainty:'Confirmed',notes:'',affects_runway:true,recurring_monthly:false,milestone:false}];
  data.transactions = [
    ['gas-now','Fuel stop','gas',3200,today(),'checking'],
    ['household-now','The Salvation Army','household',1375,today(),'credit'],
    ['gas-old','Previous month fuel','gas',4500,addMonths(monthOf(today()),-1),'checking'],
  ].map(([id,merchant,category,amount,date,account]) => ({id:String(id),merchant:String(merchant),category_id:String(category),amount_cents:Number(amount),date:String(date),account_id:String(account),kind:'expense',excluded:false,pending:false,removed:false,note:'',splits:[],source:'plaid',currency:'USD',needs_review:false}));
  data.transactions.push({ ...data.transactions[0], id:'split', merchant:'Shared purchase', amount_cents:2000, category_id:null, splits:[{category_id:'gas',amount_cents:1000},{category_id:'household',amount_cents:1000}] });
  return data;
}

async function installMock(page: Page, state: {value: DashboardPreferences | null}, publicReport = false) {
  const data = household();
  if (publicReport) {
    data.snap_balances[0].observed_at = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
    data.snap_public_observations = [
      {id:'snap-public:accepted',benefit_month:monthOf(today()),balance_cents:19758,observed_at:new Date().toISOString(),received_at:new Date().toISOString(),flagged:false},
      {id:'snap-public:flagged',benefit_month:monthOf(today()),balance_cents:90000,observed_at:new Date(Date.now()+60_000).toISOString(),received_at:new Date().toISOString(),flagged:true},
    ];
  }
  const token = `${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:userId,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.c2FtcGxl`;
  const session = {access_token:token,refresh_token:'sample-refresh-token',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:userId,email:'example@example.com',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}};
  await page.addInitScript(value => { document.cookie = `sb-tcrbcqrsafuckhsknfoy-auth-token=base64-${value}; Path=/; SameSite=Lax`; },Buffer.from(JSON.stringify(session)).toString('base64url'));
  await page.route(mockUrl + '/auth/v1/**', async route => { await route.fulfill({status:200,json:session.user}); });
  await page.route(mockUrl + '/rest/v1/**', async route => {
    const url = new URL(route.request().url());
    const table = url.pathname.split('/').pop()!;
    if (table === 'list_import_match_rejections') {await route.fulfill({status:200,json:[]});return;}
    if (table === 'dashboard_preferences') {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        state.value = {sections:body.sections,account_ids:body.account_ids,category_ids:body.category_ids};
        await route.fulfill({status:201,body:''});
      } else await route.fulfill({status:200,json:state.value ? [state.value] : []});
      return;
    }
    if (table === 'members' && url.searchParams.get('select') === 'name,role') {
      await route.fulfill({status:200,json:{name:'Luke',role:'admin'}});return;
    }
    const tableKeys: Record<string,string> = {monthly_limits:'limits',financial_events:'events',reservoir_entries:'reservoir',snap_balance_snapshots:'snap_balances',household_invitations:'invitations',financial_reviews:'reviews'};
    await route.fulfill({status:200,json:table === 'settings' ? data.settings : data[(tableKeys[table] ?? table) as keyof typeof data]});
  });
  await page.routeWebSocket('wss://tcrbcqrsafuckhsknfoy.supabase.co/**', socket => socket.close());
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Overview',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Customize dashboard',exact:true})).toBeEnabled();
}

test('saved dashboard is fetched by a second device and accounts open their purchases', async ({page,browser}) => {
  const state = {value:null as DashboardPreferences | null};
  await installMock(page,state);
  await expect(page.getByText('$12,819.26',{exact:true})).toBeVisible();
  await expect(page.getByText('$637.45',{exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:/Everyday checking/}).click();
  await expect(page.getByRole('combobox',{name:'Filter account'})).toHaveValue('checking');
  await expect(page.getByText('Fuel stop',{exact:true})).toBeVisible();
  await expect(page.getByText('The Salvation Army',{exact:true})).toBeHidden();
  await page.getByRole('button',{name:'Home',exact:true}).first().click();
  await page.getByRole('button',{name:'Customize dashboard',exact:true}).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('switch',{name:'SNAP balance',exact:true}).uncheck();
  await dialog.getByLabel('All accounts',{exact:true}).uncheck();
  await dialog.getByLabel(/Rewards card/).uncheck();
  await dialog.getByRole('button',{name:'Save dashboard',exact:true}).click();
  await expect(page.getByRole('region',{name:'SNAP balance',exact:true})).toBeHidden();
  const context = await browser.newContext();
  try {
    const second = await context.newPage();
    await installMock(second,state);
    await expect(second.getByRole('region',{name:'SNAP balance',exact:true})).toBeHidden();
    await expect(second.getByRole('button',{name:/Rewards card/})).toBeHidden();
    await expect(second.getByRole('button',{name:/Everyday checking/})).toBeVisible();
  } finally {await context.close();}
});

test('category drilldown includes split purchases and supports full history', async ({page}) => {
  await installMock(page,{value:null});
  await page.getByRole('button',{name:'View Gas purchases',exact:true}).click();
  await expect(page.getByText('Fuel stop',{exact:true})).toBeVisible();
  await expect(page.getByText('Shared purchase',{exact:true})).toBeVisible();
  await expect(page.getByText('Previous month fuel',{exact:true})).toBeHidden();
  await page.getByRole('button',{name:'All time',exact:true}).click();
  await expect(page.getByText('Previous month fuel',{exact:true})).toBeVisible();
});

test('dashboard labels keyless SNAP reports and withholds flagged amounts', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await installMock(page,{value:null},true);
  const card = page.getByRole('region',{name:'SNAP balance',exact:true});
  await expect(card.getByText('$197.58')).toBeVisible();
  await expect(card.getByText(/Unverified Muse report/)).toBeVisible();
  await expect(card.getByText(/newer report was held/)).toBeVisible();
  await expect(card.getByText('$900.00')).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/snap-unverified-phone.png',fullPage:true});
});

test('dashboard and customization fit desktop, phone, and dark appearance', async ({page}) => {
  await page.setViewportSize({width:1440,height:960});
  const errors:string[]=[];
  page.on('pageerror', error => errors.push(error.message));
  await installMock(page,{value:defaultDashboardPreferences()});
  await page.screenshot({path:'test-results/dashboard-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await expect.poll(() => page.locator('.sidebar').evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/dashboard-phone.png',fullPage:true});
  await page.getByRole('button',{name:'Customize dashboard',exact:true}).click();
  await expect.poll(() => page.getByRole('dialog').evaluate(element => {const rect=element.getBoundingClientRect();return rect.left >= 0 && rect.right <= innerWidth && element.scrollWidth <= element.clientWidth;})).toBe(true);
  await page.screenshot({path:'test-results/dashboard-customize.png'});
  await page.getByRole('button',{name:'Close dialog'}).click();
  await page.setViewportSize({width:1440,height:960});
  await page.getByRole('button',{name:/Luke.*Squires household/}).click();
  await page.getByRole('button',{name:'Dark mode',exact:true}).click();
  await page.getByRole('button',{name:'Home',exact:true}).first().click();
  await page.screenshot({path:'test-results/dashboard-dark.png',fullPage:true});
  expect(errors).toEqual([]);
});
