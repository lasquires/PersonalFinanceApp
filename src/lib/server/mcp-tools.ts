import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { createSuggestedTask,createTip,listBudgetStatus,listRecentTransactions,listTasks,listTips,reviewWeek } from './assistant';

export const toolNames=['review_week','list_budget_status','list_recent_transactions','list_tasks','list_tips','create_tip','create_task'] as const;
type Context={actorId:string;clientId:string;db:any};
const text=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value)}]});

export function createMcpServer(context:Context){
  const server=new McpServer({name:'squires-family-finance',version:'1.0.0'});
  server.registerTool('review_week',{description:'Reviews the last seven days of household finances and the next 90 days of planned events.',inputSchema:{}},async()=>text(await reviewWeek(context.db)));
  server.registerTool('list_budget_status',{description:'Lists current category budgets, spending, and remaining amounts.',inputSchema:{}},async()=>text(await listBudgetStatus(context.db)));
  server.registerTool('list_recent_transactions',{description:'Lists up to 100 recent household spending records from at most the last 90 days.',inputSchema:{days:z.number().int().min(1).max(90).optional(),limit:z.number().int().min(1).max(100).optional()}},async input=>text(await listRecentTransactions(context.db,input)));
  server.registerTool('list_tasks',{description:'Lists up to 100 active, waiting, or suggested household tasks.',inputSchema:{limit:z.number().int().min(1).max(100).optional()}},async input=>text(await listTasks(context.db,input)));
  server.registerTool('list_tips',{description:'Lists up to 100 household finance tips.',inputSchema:{}},async()=>text(await listTips(context.db)));
  server.registerTool('create_tip',{description:'Creates a finance tip and writes it to the household app after user confirmation.',inputSchema:{title:z.string().min(1).max(120),body:z.string().min(1).max(800),evidence:z.record(z.string(),z.union([z.string(),z.number(),z.boolean(),z.null()])).optional(),expires_at:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()},annotations:{destructiveHint:false,idempotentHint:false,openWorldHint:false}},async input=>text(await createTip(context.db,input,{actorId:context.actorId,clientId:context.clientId,toolName:'create_tip'})));
  server.registerTool('create_task',{description:'Creates a suggested task and writes it to the household app after user confirmation.',inputSchema:{title:z.string().min(1).max(200),priority:z.enum(['High','Normal','Low']).optional(),assignee:z.enum(['Luke','Samantha','Together']).optional(),due_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),impact_cents:z.number().int().min(0).optional(),impact_type:z.enum(['once','monthly']).optional(),notes:z.string().max(1000).optional(),category_id:z.string().nullable().optional(),event_id:z.string().nullable().optional()},annotations:{destructiveHint:false,idempotentHint:false,openWorldHint:false}},async input=>text(await createSuggestedTask(context.db,input,{actorId:context.actorId,clientId:context.clientId,toolName:'create_task'})));
  return server;
}

export async function handleMcpRequest(request:Request,context:Context){const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});const server=createMcpServer(context);await server.connect(transport);return transport.handleRequest(request);}
