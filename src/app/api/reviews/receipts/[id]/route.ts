import { authorizeReviewRequest } from '@/lib/server/reviews-auth';
import { readReviewReceipt } from '@/lib/server/reviews';
import { reviewErrorResponse,reviewJson } from '@/lib/reviews/http';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){try{const identity=await authorizeReviewRequest(request,'receipt');return reviewJson(await readReviewReceipt(identity,(await params).id));}catch(error){return reviewErrorResponse(error);}}
