import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewHandoff, museCourierPrompt } from '../src/lib/reviews/handoff';
import { buildReviewSnapshot } from '../src/lib/reviews/export';
import { reviewPacketSchema } from '../src/lib/reviews/contracts';
import { previousReviewPeriod } from '../src/lib/reviews/periods';
import { defaults } from '../src/lib/defaults';
test('handoff example is valid and courier instructions preserve boundaries and retry identity',()=>{
 const snapshot=buildReviewSnapshot(defaults(),{snapshotId:'11111111-1111-4111-8111-111111111111',generatedAt:new Date().toISOString(),period:previousReviewPeriod('weekly'),recentReviews:[]});
 const handoff=buildReviewHandoff(snapshot);
 assert.equal(reviewPacketSchema.safeParse(handoff.examplePacket).success,true);
 const prompt=museCourierPrompt('https://squires-family-finance.vercel.app');
 for(const word of ['FINANCE_REVIEW_TOKEN','/api/reviews/snapshot','/api/reviews/reports','/api/reviews/receipts/','America/New_York','9:00','five','Retry-After','401','403','409','identical','Google','manual'])assert.ok(prompt.includes(word),word);
 for(const word of ['untrusted','matched','SNAP','stable','agreed','suggested','missing'])assert.ok(handoff.analysisInstructions.includes(word),word);
 assert.ok(handoff.schema);
});
