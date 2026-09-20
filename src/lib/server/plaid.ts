import 'server-only';
import { Configuration, PlaidApi, PlaidEnvironments, type Transaction as PlaidTransaction, type AccountBase } from 'plaid';
import { classify } from '../finance';
import { adminDb } from './auth';
export type Item = {id:string;access_token:string;cursor:string;institution:string;member:string;sync_error:string|null};
export function plaid() {
 const env=process.env.PLAID_ENV??'sandbox';
 if(!['sandbox','production'].includes(env))throw new Error('Invalid Plaid environment');
 if(env==='production'&&process.env.PLAID_PRODUCTION_ENABLED!=='true')throw new Error('Production connections are disabled until the Plaid plan is verified.');
 if(!process.env.PLAID_CLIENT_ID||!process.env.PLAID_SECRET)throw new Error('Plaid is not configured yet.');
 return new PlaidApi(new Configuration({basePath:PlaidEnvironments[env],baseOptions:{timeout:25000,headers:{'PLAID-CLIENT-ID':process.env.PLAID_CLIENT_ID,'PLAID-SECRET':process.env.PLAID_SECRET}}}));
}
export async function items():Promise<Item[]> { const {data,error}=await adminDb().rpc('server_items');if(error)throw new Error('Could not read connection status');return data; }
export function normalized(t:PlaidTransaction) {
 const p=t.personal_finance_category;const classification=classify(p?.primary,p?.detailed);
 const categories:Record<string,string>={TRANSPORTATION_GAS:'gas',FOOD_AND_DRINK_GROCERIES:'food',GENERAL_MERCHANDISE_SUPERSTORES:'household',RENT_AND_UTILITIES_GAS_AND_ELECTRICITY:'electricity',RENT_AND_UTILITIES_WATER:'water',RENT_AND_UTILITIES_INTERNET_AND_CABLE:'internet',MEDICAL_DENTAL_CARE:'medical',MEDICAL_PRIMARY_CARE:'medical',MEDICAL_PHARMACIES_AND_SUPPLEMENTS:'medical'};
 const category=categories[p?.detailed??'']??null;
 return{id:t.transaction_id,account_id:t.account_id,merchant:t.merchant_name??t.name,date:t.date,amount_cents:Math.round(t.amount*100),category_id:category,kind:classification.kind,pending:t.pending,pending_transaction_id:t.pending_transaction_id,currency:t.iso_currency_code??'UNKNOWN',needs_review:classification.review||(!category&&classification.kind==='expense')||p?.detailed==='GENERAL_MERCHANDISE_SUPERSTORES'};
}
export async function syncItem(item:Item) {
 const client=plaid();const db=adminDb();
 for(let attempt=0;attempt<3;attempt++) {
  let cursor=item.cursor;const added:ReturnType<typeof normalized>[]=[];const modified:ReturnType<typeof normalized>[]=[];const removed:{transaction_id:string}[]=[];let accounts:AccountBase[]=[];
  try{
   for(let pages=0;pages<100;pages++) {const {data}=await client.transactionsSync({access_token:item.access_token,cursor,count:500});added.push(...data.added.map(normalized));modified.push(...data.modified.map(normalized));removed.push(...data.removed);accounts=data.accounts;cursor=data.next_cursor;if(!data.has_more)break;if(pages===99)throw new Error('SYNC_PAGE_LIMIT');}
   const result=await db.rpc('server_apply_sync',{item:item.id,expected_cursor:item.cursor,next_cursor:cursor,added,modified,removed,account_rows:accounts});
   if(result.error)throw new Error('DATABASE_SYNC_FAILED');
   if(!result.data){const fresh=(await items()).find(i=>i.id===item.id);if(!fresh)throw new Error('ITEM_NOT_FOUND');item=fresh;continue;}
   return {added:added.length,modified:modified.length,removed:removed.length};
  }catch(error){const code=plaidCode(error);if(code==='TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION'&&attempt<2)continue;await db.rpc('server_sync_error',{item:item.id,code});throw new Error(code);}
 }
 throw new Error('SYNC_BUSY');
}
export function plaidCode(error:unknown):string {const e=error as {response?:{data?:{error_code?:string}};message?:string};const code=e.response?.data?.error_code;if(code&&/^[A-Z_]+$/.test(code))return code;return ['DATABASE_SYNC_FAILED','SYNC_PAGE_LIMIT','ITEM_NOT_FOUND','SYNC_BUSY'].includes(e.message??'')?e.message!:'SYNC_FAILED';}
