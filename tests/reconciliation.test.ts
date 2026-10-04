import test from 'node:test';
import assert from 'node:assert/strict';
import type { Transaction } from '../src/lib/types';
import { allocations } from '../src/lib/finance';
import { eligibleMatches, likelyMatches, reconcilePreview, savePreviewPurchase } from '../src/lib/reconciliation';
import { defaults } from '../src/lib/defaults';
const manual: Transaction = {id:'manual',merchant:'The Salvation Army',date:'2026-10-01',amount_cents:1375,category_id:'household',account_id:null,kind:'expense',excluded:false,pending:false,removed:false,note:'Keep this',splits:[],source:'manual',currency:'USD',needs_review:false};
const bank: Transaction = {...manual,id:'bank',source:'plaid',category_id:null,budget_state:'unbudgeted'};

test('held and matched imports never duplicate manual budget allocations', () => {
  assert.deepEqual(allocations({...bank,category_id:'household',budget_state:'held'}),[]);
  assert.deepEqual(allocations({...bank,category_id:'household',budget_state:'matched',matched_manual_id:manual.id}),[]);
  assert.equal(allocations(manual)[0].amount_cents,1375);
});
test('match eligibility is signed, bounded, account aware, and excludes linked or rejected entries', () => {
  const rows = [manual,{...manual,id:'other',merchant:'Unrelated store'}, {...manual,id:'refund',amount_cents:-1375}, {...manual,id:'old',date:'2026-09-23'}, {...manual,id:'excluded',excluded:true}, {...manual,id:'removed',removed:true}, {...manual,id:'account',account_id:'different'}];
  assert.deepEqual(eligibleMatches({...bank,account_id:'checking'},rows).map(t=>t.id),['manual','other']);
  assert.deepEqual(likelyMatches(bank,rows).map(t=>t.id),['account','manual']);
  assert.equal(eligibleMatches(bank,[manual],[{import_id:'bank',manual_id:'manual'}]).length,0);
  assert.equal(eligibleMatches(bank,[manual,{...bank,id:'linked',budget_state:'matched',matched_manual_id:'manual'}]).length,0);
});
test('preview matching is reversible and preserves manual splits and notes', () => {
  const data=defaults(); data.transactions=[{...manual,splits:[{category_id:'gas',amount_cents:500},{category_id:'household',amount_cents:875}],category_id:null},bank];
  const matched=reconcilePreview(data,'match_import',{import_id:'bank',manual_id:'manual'});
  assert.equal(matched.transactions[1].budget_state,'matched');
  assert.deepEqual(matched.transactions[0],data.transactions[0]);
  const undone=reconcilePreview(matched,'unmatch_import',{import_id:'bank'});
  assert.equal(undone.transactions[1].budget_state,'unbudgeted');
});
test('rejecting one possible match does not reject another identical manual purchase',()=>{
 const data=defaults();data.transactions=[manual,{...manual,id:'second'},{...bank,category_id:'household',budget_state:'held'}];
 const result=reconcilePreview(data,'separate_import',{import_id:'bank',manual_id:'manual'});
 assert.deepEqual(likelyMatches(result.transactions[2],result.transactions,result.match_rejections).map(t=>t.id),['second']);
 assert.equal(result.transactions[2].budget_state,'held');
});
test('preview remembers only explicit merchant categories and holds a later duplicate',()=>{
 const data=defaults();data.transactions=[];
 const remembered=savePreviewPurchase(data,manual,true);
 const imported=savePreviewPurchase(remembered,bank);
 assert.equal(imported.transactions[1].category_id,'household');
 assert.equal(imported.transactions[1].budget_state,'held');
 assert.equal(imported.transactions[1].needs_review,true);
 const separate=reconcilePreview(imported,'separate_import',{import_id:'bank',manual_id:'manual'});
 assert.equal(separate.transactions[1].needs_review,false);
 const unmatched=savePreviewPurchase(remembered,{...bank,id:'different',amount_cents:2000});
 assert.equal(unmatched.transactions[1].budget_state,'budgeted');
 const ordinary=savePreviewPurchase(data,bank);
 assert.equal(ordinary.transactions[0].budget_state,'unbudgeted');
 assert.equal(ordinary.transactions[0].category_id,null);
});
