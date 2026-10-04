import { createHash } from 'node:crypto';
import { checkReviewDb, ReviewError } from '../reviews/http';
export type ReviewIdentity={member_id:string|null;courier_hash:string|null};
type Dependencies={session:()=>Promise<{member:{id:string;role:string}}>;db:()=>any};
export async function authorizeReviewRequest(request:Request,operation:'export'|'delivery'|'receipt',deps?:Dependencies):Promise<ReviewIdentity>{
 if(!deps){const auth=await import('./auth');deps={session:()=>auth.requireMember(request),db:auth.adminDb};}
 const header=request.headers.get('authorization');
 if(header!==null){
  const match=/^Bearer (review_[A-Za-z0-9_-]{43})$/.exec(header);
  if(!match)throw new ReviewError(401,'Unauthorized');
  const courier_hash=createHash('sha256').update(match[1]).digest('hex');
  const {error}=await deps.db().rpc('server_review_identity',{member_id:null,courier_hash});checkReviewDb(error);
  return {member_id:null,courier_hash};
 }
 const origin=request.headers.get('origin');
 if(request.method!=='GET'&&origin&&origin!==new URL(request.url).origin&&origin!==process.env.APP_URL)throw new ReviewError(403,'Forbidden origin.');
 let member:{id:string;role:string};try{member=(await deps.session()).member;}catch{throw new ReviewError(401,'Sign in required.');}
 if(member.role==='viewer'&&operation!=='receipt')throw new ReviewError(403,'Household write access required.');
 return {member_id:member.id,courier_hash:null};
}
