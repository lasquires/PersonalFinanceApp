import test from 'node:test';
import assert from 'node:assert/strict';
import { createInvitation, normalizeEmail, invitationInput, type InvitationDependencies } from '../src/lib/server/household-admin';

test('normalize email trims and canonicalizes case', () => {
  assert.equal(normalizeEmail('  Luke@Example.COM '), 'luke@example.com');
});

test('invitation input defaults to viewer and rejects malformed email', () => {
  assert.deepEqual(invitationInput.parse({ email:'guest@example.com' }), { email:'guest@example.com', role:'viewer' });
  assert.throws(() => invitationInput.parse({ email:'not-an-email', role:'member' }));
});

function dependencies(role:'admin'|'member'|'viewer'='admin') {
  const calls:{email:string;redirectTo:string}[]=[];
  const deps:InvitationDependencies = {
    actor:{id:'11111111-1111-1111-1111-111111111111',role},
    appUrl:'https://squires-family-finance.vercel.app',
    existingMember:async()=>false,
    existingPending:async()=>null,
    savePending:async input=>({id:'invite-1',...input}),
    markError:async()=>undefined,
    sendInvite:async(email,redirectTo)=>{calls.push({email,redirectTo});},
  };
  return {deps,calls};
}

test('only admins can create an invitation', async () => {
  const {deps}=dependencies('member');
  await assert.rejects(createInvitation({email:'guest@example.com',role:'viewer'},deps),/Administrator access required/);
});

test('invitation stores only a token hash and sends the single-use token in redirect', async () => {
  const {deps,calls}=dependencies();
  let storedToken='';
  deps.savePending=async input=>{storedToken=input.token_hash;return{id:'invite-1',...input};};
  const result=await createInvitation({email:' Guest@Example.com ',role:'viewer'},deps);
  assert.equal(result.status,'pending');
  assert.match(storedToken,/^[a-f0-9]{64}$/);
  assert.equal(storedToken.includes('guest'),false);
  assert.equal(calls[0].email,'guest@example.com');
  assert.match(calls[0].redirectTo,/\/invite\/accept\?token=/);
  assert.equal(calls[0].redirectTo.includes(storedToken),false);
});

test('failed invitation delivery records a retryable error', async () => {
  const {deps}=dependencies();
  let failed='';
  deps.sendInvite=async()=>{throw new Error('provider unavailable');};
  deps.markError=async id=>{failed=id;};
  await assert.rejects(createInvitation({email:'guest@example.com'},deps),/Invitation email could not be sent/);
  assert.equal(failed,'invite-1');
});

test('invitation rejects existing members and canonical duplicate pending email', async () => {
  const first=dependencies();first.deps.existingMember=async email=>email==='guest@example.com';
  await assert.rejects(createInvitation({email:' Guest@Example.com '},first.deps),/already a household member/);
  const second=dependencies();second.deps.existingPending=async email=>email==='guest@example.com'?{id:'pending',email,role:'viewer',token_hash:'a'.repeat(64),invited_by:second.deps.actor.id,expires_at:new Date().toISOString()}:null;
  await assert.rejects(createInvitation({email:'GUEST@example.com'},second.deps),/already pending/);
});
