import { authenticateBearer } from '@/lib/server/oauth';
import { handleMcpRequest } from '@/lib/server/mcp-tools';

const metadataUrl=()=>`${(process.env.APP_URL??'https://squires-family-finance.vercel.app').replace(/\/$/,'')}/.well-known/oauth-protected-resource`;
export async function POST(request:Request){try{const context=await authenticateBearer(request);return await handleMcpRequest(request,context);}catch(error){const message=(error as Error).message;const unauthorized=/Bearer token|required|invalid/i.test(message);return Response.json({error:message},{status:unauthorized?401:403,headers:unauthorized?{'WWW-Authenticate':`Bearer resource_metadata="${metadataUrl()}"`}:undefined});}}
export function GET(){return new Response(null,{status:405,headers:{Allow:'POST'}});}
export function DELETE(){return new Response(null,{status:405,headers:{Allow:'POST'}});}
