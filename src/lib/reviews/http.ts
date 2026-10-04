import { REPORT_BYTE_LIMIT } from './contracts';
export class ReviewError extends Error { constructor(public status:number,message:string,public fields:string[]=[]){super(message);} }
export function canonicalJson(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
 if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJson((value as Record<string,unknown>)[k])).join(',')+'}';
 return JSON.stringify(value);
}
export async function readReviewJson(request:Request) {
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))throw new ReviewError(415,'Expected a JSON packet.');
 if(Number(request.headers.get('content-length')??0)>REPORT_BYTE_LIMIT)throw new ReviewError(413,'Packet exceeds 256 KiB.');
 const reader=request.body?.getReader();if(!reader)throw new ReviewError(400,'Expected a JSON packet.');
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>REPORT_BYTE_LIMIT){await reader.cancel();throw new ReviewError(413,'Packet exceeds 256 KiB.');}chunks.push(value);}}
 finally{reader.releaseLock();}
 const body=new Uint8Array(size);let offset=0;for(const c of chunks){body.set(c,offset);offset+=c.byteLength;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body)) as unknown;}catch{throw new ReviewError(400,'Expected valid UTF-8 JSON.');}
}
export function reviewJson(value:unknown,status=200){return Response.json(value,{status,headers:{'Cache-Control':'no-store'}});}
export function reviewErrorResponse(error:unknown) {
 const e=error instanceof ReviewError?error:new ReviewError(503,'Financial reviews are temporarily unavailable. Check the database update and try again.');
 const response=reviewJson({error:e.message,...(e.fields.length?{fields:e.fields}:{})},e.status);
 if(e.status===429)response.headers.set('Retry-After','3600');return response;
}
export function checkReviewDb(error:{message:string}|null){
 if(!error)return; const m=error.message;
 if(/Unauthorized/.test(m))throw new ReviewError(401,'Unauthorized');
 if(/access required/.test(m))throw new ReviewError(403,'Household write access required.');
 if(/rate limit/.test(m))throw new ReviewError(429,'Review request limit reached. Try again later.');
 if(/conflict/.test(m))throw new ReviewError(409,'That revision already has different content.');
 if(/Expected revision \d+/.test(m))throw new ReviewError(409,m.match(/Expected revision \d+/)![0]);
 if(/Unknown snapshot|period mismatch|Invalid (report generation time|task category|task event|existing task reference)/.test(m))throw new ReviewError(400,'The packet does not match its snapshot, dates, or task references.');
 throw new ReviewError(503,'Financial reviews are temporarily unavailable.');
}
