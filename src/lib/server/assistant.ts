import { z } from 'zod';

type QueryResult<T>={data:T|null;error:{message:string}|null};
type AssistantDb={from:(table:string)=>any;rpc:(name:string,args:Record<string,unknown>)=>Promise<QueryResult<unknown>>};
export type AssistantContext={actorId:string;clientId:string;toolName:string};

const secretKey=/(access.?token|refresh.?token|service.?role|secret|password|authorization|bearer|plaid)/i;
const evidenceValue=z.union([z.string().max(500),z.number().finite(),z.boolean(),z.null()]);
export const evidenceSchema=z.record(z.string().min(1).max(80),evidenceValue).superRefine((value,ctx)=>{
  const keys=Object.keys(value);
  if(keys.length>20)ctx.addIssue({code:'custom',message:'Evidence is limited to 20 fields'});
  for(const key of keys)if(secretKey.test(key))ctx.addIssue({code:'custom',message:'Evidence cannot contain secret-like fields',path:[key]});
});
const isoDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const tipSchema=z.object({title:z.string().trim().min(1).max(120),body:z.string().trim().min(1).max(800),evidence:evidenceSchema.default({}),expires_at:isoDate.nullable().optional()}).strict();
export const suggestedTaskSchema=z.object({title:z.string().trim().min(1).max(200),status:z.literal('Suggested').optional(),priority:z.enum(['High','Normal','Low']).default('Normal'),assignee:z.enum(['Luke','Samantha','Together']).default('Together'),due_date:isoDate.nullable().optional(),impact_cents:z.number().int().min(0).max(10_000_000_000).default(0),impact_type:z.enum(['once','monthly']).default('once'),notes:z.string().max(1000).default(''),category_id:z.string().min(1).max(100).nullable().optional(),event_id:z.string().min(1).max(200).nullable().optional()}).strict();

function fail(error:{message:string}|null){if(error)throw new Error(error.message);}
function daysAgo(now:Date,days:number){return new Date(now.getTime()-days*86_400_000).toISOString().slice(0,10);}

export async function listBudgetStatus(db:AssistantDb){const result=await db.from('assistant_monthly_budget').select('category_id,name,group,rollover,budget_cents,carried_cents,spent_cents,remaining_cents').order('name').limit(100);fail(result.error);return result.data??[];}
export async function listRecentTransactions(db:AssistantDb,input:{days?:number;limit?:number}={},now=new Date()){const query={days:Math.min(90,Math.max(1,input.days??7)),limit:Math.min(100,Math.max(1,input.limit??50))};const result=await db.from('assistant_spending').select('id,date,merchant,pending,category_id,amount_cents').gte('date',daysAgo(now,query.days)).order('date',{ascending:false}).limit(query.limit);fail(result.error);return{query,transactions:result.data??[]};}
export async function listTasks(db:AssistantDb,input:{limit?:number}={}){const limit=Math.min(100,Math.max(1,input.limit??100));const result=await db.from('assistant_attention').select('id,title,status,priority,assignee,due_date,impact_cents,impact_type,notes,category_id,event_id').order('due_date',{ascending:true,nullsFirst:false}).limit(limit);fail(result.error);return{limit,tasks:result.data??[]};}
export async function listTips(db:AssistantDb){const result=await db.from('tips').select('id,title,body,evidence,status,expires_at,origin,created_at').order('created_at',{ascending:false}).limit(100);fail(result.error);return result.data??[];}
export async function reviewWeek(db:AssistantDb,now=new Date()){const [budget,transactions,tasks,tips]=await Promise.all([listBudgetStatus(db),listRecentTransactions(db,{days:7,limit:100},now),listTasks(db),listTips(db)]);const events=await db.from('assistant_upcoming_events').select('id,name,date,amount_cents,direction,certainty,notes,affects_runway,recurring_monthly,milestone').lte('date',new Date(now.getTime()+90*86_400_000).toISOString().slice(0,10)).order('date').limit(100);fail(events.error);return{as_of:now.toISOString(),budget,transactions:transactions.transactions,tasks:tasks.tasks,tips,upcoming_events:events.data??[]};}

export async function createTip(db:AssistantDb,input:unknown,context:AssistantContext){const payload=tipSchema.parse(input);const result=await db.rpc('assistant_create_tip',{payload,oauth_client_id:context.clientId,tool_name:context.toolName});fail(result.error);return result.data;}
export async function createSuggestedTask(db:AssistantDb,input:unknown,context:AssistantContext){const parsed=suggestedTaskSchema.parse(input);const payload={...parsed,status:'Suggested'};const result=await db.rpc('assistant_create_suggested_task',{payload,oauth_client_id:context.clientId,tool_name:context.toolName});fail(result.error);return result.data;}
