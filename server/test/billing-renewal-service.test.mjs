import assert from "node:assert/strict";
import test from "node:test";
import { createBillingRenewalService } from "../src/billing-renewal-service.mjs";
import { encryptCredentialPayload } from "../src/credential-crypto.mjs";
import { ApiError } from "../src/domain.mjs";

function fixture({ attempt = 1 } = {}) {
  const key=Buffer.alloc(32,9),periodEnd=new Date("2026-11-04T00:00:00Z"),envelope=encryptCredentialPayload({credentials:{billingKey:"billing-secret",customerKey:"customer-secret"},plaintextDataKey:key,encryptedDataKey:"ZW5j",keyVersion:"version-1",provider:"toss-billing"});
  return {key,periodEnd,claim:{claimToken:"claim-a",attempt,planId:"starter",periodEnd,envelope}};
}

test("기한이 된 구독은 결정적 주문으로 한 번 갱신하고 평문 데이터 키를 지운다",async()=>{
  const value=fixture(),calls=[],repository={listDue:async()=>[{workspaceId:"workspace-a"}],claim:async()=>value.claim,succeed:async input=>calls.push(["succeed",input]),failRenewal:async()=>assert.fail("must not fail")},provider={charge:async input=>{calls.push(["charge",input]);return{paymentKey:"payment-a",orderId:input.orderId,status:"DONE",currency:"KRW",totalAmount:19900,approvedAt:"2026-11-04T00:00:01Z"}}},keyManager={decryptDataKey:async()=>value.key};
  const result=await createBillingRenewalService({repository,provider,keyManager,now:()=>new Date("2026-11-04T00:00:00Z")}).runOnce();
  assert.deepEqual(result,{examined:1,succeeded:1,failed:0,skipped:0});assert.match(calls[0][1].orderId,/^aw_r_[a-f0-9]{48}$/);assert.match(calls[0][1].idempotencyKey,/^renew_[a-f0-9]{64}$/);assert.deepEqual(value.key,Buffer.alloc(32));assert.equal(calls[1][1].payment.totalAmount,19900);
});

test("결제 실패는 1일차와 3일차 재시도 뒤 추가 호출을 예약하지 않는다",async()=>{
  for(const [attempt,expected] of [[1,"2026-11-05T00:00:00.000Z"],[2,"2026-11-07T00:00:00.000Z"],[3,null]]){const value=fixture({attempt}),failures=[],repository={listDue:async()=>[{workspaceId:"workspace-a"}],claim:async()=>value.claim,succeed:async()=>assert.fail("must not succeed"),failRenewal:async input=>failures.push(input)},provider={charge:async()=>{throw new ApiError("PAYMENT_REJECTED","거절",422)}},keyManager={decryptDataKey:async()=>Buffer.from(value.key)};const result=await createBillingRenewalService({repository,provider,keyManager,now:()=>new Date("2026-11-04T00:00:00Z")}).runOnce();assert.equal(result.failed,1);assert.equal(failures[0].nextRenewalAt?.toISOString()||null,expected);assert.equal(failures[0].graceEnd.toISOString(),"2026-11-07T00:00:00.000Z")}
});

test("이미 다른 작업이 선점한 구독은 결제사를 호출하지 않는다",async()=>{let called=false;const result=await createBillingRenewalService({repository:{listDue:async()=>[{workspaceId:"workspace-a"}],claim:async()=>null},provider:{charge:async()=>{called=true}},keyManager:{},now:()=>new Date()}).runOnce();assert.deepEqual(result,{examined:1,succeeded:0,failed:0,skipped:1});assert.equal(called,false)});

test("실패 기록 잠금까지 잃은 작업은 다른 후보 처리를 막지 않는다",async()=>{const value=fixture(),claimed=[],repository={listDue:async()=>[{workspaceId:"workspace-a"},{workspaceId:"workspace-b"}],claim:async({workspaceId})=>({...value.claim,claimToken:workspaceId}),succeed:async()=>assert.fail("must not succeed"),failRenewal:async({workspaceId})=>{claimed.push(workspaceId);if(workspaceId==="workspace-a")throw new Error("lock lost")}},provider={charge:async()=>{throw new ApiError("PAYMENT_REJECTED","거절",422)}},keyManager={decryptDataKey:async()=>Buffer.from(value.key)};const result=await createBillingRenewalService({repository,provider,keyManager,now:()=>new Date("2026-11-04T00:00:00Z")}).runOnce();assert.deepEqual(result,{examined:2,succeeded:0,failed:1,skipped:1});assert.deepEqual(claimed,["workspace-a","workspace-b"])});

