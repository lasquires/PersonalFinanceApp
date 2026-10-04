import { authorizeReviewRequest } from '@/lib/server/reviews-auth';
import { chatgptAnalysisPrompt,reviewPacketJsonSchema } from '@/lib/reviews/handoff';
import { reviewErrorResponse,reviewJson } from '@/lib/reviews/http';
export async function GET(request:Request){try{await authorizeReviewRequest(request,'receipt');return reviewJson({schema_version:1,analysis_instructions:chatgptAnalysisPrompt(),packet_schema:reviewPacketJsonSchema()});}catch(error){return reviewErrorResponse(error);}}
