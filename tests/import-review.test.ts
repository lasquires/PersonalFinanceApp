import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImportReview } from '../src/components/import-review';
import { defaults } from '../src/lib/defaults';
import type { Transaction } from '../src/lib/types';

const manual: Transaction = {id:'manual',merchant:'Costco',date:'2026-10-21',amount_cents:2500,category_id:'household',account_id:null,kind:'expense',excluded:false,pending:false,removed:false,note:'Birthday supplies',splits:[],source:'manual',currency:'USD',needs_review:false};
const bank: Transaction = {...manual,id:'bank',source:'plaid',note:'',budget_state:'held',needs_review:true};
function render(manuals: Transaction[], canWrite=true) {
  const data=defaults(); data.transactions=[...manuals,bank];
  return renderToStaticMarkup(createElement(ImportReview,{data,rows:[bank],save:async()=>{},onEdit:()=>{},canWrite,stage:'review'}));
}
test('a single suggestion exposes confirmation and the manual note without opening a picker',()=>{
  const html=render([manual]);
  assert.match(html,/Confirm match/);
  assert.match(html,/Birthday supplies/);
  assert.match(html,/Needs attention/);
  assert.match(html,/Match existing purchase/);
});
test('ambiguous matches and read-only access do not offer direct confirmation',()=>{
  assert.doesNotMatch(render([manual,{...manual,id:'second'}]),/Confirm match/);
  assert.doesNotMatch(render([manual],false),/Confirm match/);
});
