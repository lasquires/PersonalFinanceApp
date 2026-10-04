import { authorizeReviewRequest } from '@/lib/server/reviews-auth';
import { deliverReview,reserveReviewDelivery } from '@/lib/server/reviews';
import { readReviewJson,reviewErrorResponse,reviewJson } from '@/lib/reviews/http';
export async function POST(request:Request){try{const identity=await authorizeReviewRequest(request,'delivery');await reserveReviewDelivery(identity);const receipt=await deliverReview(identity,await readReviewJson(request));return reviewJson(receipt,receipt.replayed?200:201);}catch(error){return reviewErrorResponse(error);}}
