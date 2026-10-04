import { authorizeReviewRequest } from '@/lib/server/reviews-auth';
import { loadReviewSnapshot } from '@/lib/server/reviews';
import { ReviewError,reviewErrorResponse,reviewJson } from '@/lib/reviews/http';
export async function GET(request:Request){try{
 const identity=await authorizeReviewRequest(request,'export');const params=new URL(request.url).searchParams;
 if([...params.keys()].some(k=>!['kind','period_start'].includes(k))||params.getAll('kind').length!==1||params.getAll('period_start').length!==1)throw new ReviewError(400,'Specify kind and period_start once.');
 const kind=params.get('kind');if(kind!=='weekly'&&kind!=='monthly')throw new ReviewError(400,'Choose weekly or monthly.');
 const result=await loadReviewSnapshot(identity,kind,params.get('period_start')??'');return reviewJson(result);
}catch(error){if(error instanceof Error && /reporting|Monday|Monthly reviews|future|time zone/i.test(error.message))return reviewErrorResponse(new ReviewError(400,'Choose valid period boundaries and timezone.'));return reviewErrorResponse(error);}}
