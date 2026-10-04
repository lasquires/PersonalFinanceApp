import test from 'node:test';
import assert from 'node:assert/strict';
import { readReviewJson, ReviewError, reviewErrorResponse, canonicalJson } from '../src/lib/reviews/http';
import { authorizeReviewRequest } from '../src/lib/server/reviews-auth';
const token='review_'+'a'.repeat(43);
const deps=(role='member',active=true)=>({session:async()=>({member:{id:'member',role}}),db:()=>({rpc:async()=>active?{data:'ok',error:null}:{data:null,error:{message:'Unauthorized'}}})});
test('review HTTP parser enforces actual bytes, JSON media type and safe error output',async()=>{
 assert.deepEqual(await readReviewJson(new Request('https://app.test',{method:'POST',headers:{'content-type':'application/json'},body:'{"ok":true}'})),{ok:true});
 await assert.rejects(readReviewJson(new Request('https://app.test',{method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(262145)})),(e:ReviewError)=>e.status===413);
 await assert.rejects(readReviewJson(new Request('https://app.test',{method:'POST',body:'{}'})),(e:ReviewError)=>e.status===415);
 await assert.rejects(readReviewJson(new Request('https://app.test',{method:'POST',headers:{'content-type':'application/json'},body:'broken'})),(e:ReviewError)=>e.status===400);
 const r=reviewErrorResponse(new Error('secret-database-connection'));assert.equal(r.status,503);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal((await r.text()).includes('secret-database'),false);
 assert.equal(canonicalJson({b:2,a:{d:4,c:3}}),canonicalJson({a:{c:3,d:4},b:2}));
});
test('review authentication rejects unrelated keys, revoked keys, viewers and cross-origin writes',async()=>{
 const req=(value?:string,origin?:string)=>new Request('https://app.test/api/reviews/reports',{method:'POST',headers:{...(value?{authorization:'Bearer '+value}:{}),...(origin?{origin}: {})}});
 assert.equal((await authorizeReviewRequest(req(token),'delivery',deps() as never)).courier_hash?.length,64);
 await assert.rejects(authorizeReviewRequest(req('snap_'+'a'.repeat(43)),'delivery',deps() as never),/Unauthorized/);
 await assert.rejects(authorizeReviewRequest(req(token),'delivery',deps('member',false) as never),/Unauthorized/);
 await assert.rejects(authorizeReviewRequest(req(),'delivery',deps('viewer') as never),/write access/);
 await assert.rejects(authorizeReviewRequest(req(undefined,'https://evil.test'),'delivery',deps() as never),/origin/i);
});
