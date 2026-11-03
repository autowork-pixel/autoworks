import test from "node:test";
import assert from "node:assert/strict";
import { assertUsableSubscription, resolveBrandSearchPlan } from "../src/subscription-policy.mjs";

const now=new Date("2026-11-03T00:00:00Z");

test("활성·베타 구독은 서버 Timestamp의 미래 종료일이 있어야 실행할 수 있다",()=>{
  const timestamp={toDate:()=>new Date("2026-12-01T00:00:00Z")};
  assert.equal(assertUsableSubscription({status:"active",periodEnd:timestamp},{now}).status,"active");
  assert.equal(assertUsableSubscription({status:"trialing",periodEnd:new Date("2026-11-04T00:00:00Z")},{now}).status,"trialing");
});

test("해지는 결제기간 종료까지, 결제 실패는 3일 유예 종료까지 이용한다",()=>{
  assert.equal(assertUsableSubscription({status:"canceled",periodEnd:new Date("2026-11-04T00:00:00Z")},{now}).status,"canceled");
  assert.equal(assertUsableSubscription({status:"past_due",graceEnd:new Date("2026-11-06T00:00:00Z")},{now}).status,"past_due");
  assert.throws(()=>assertUsableSubscription({status:"past_due",graceEnd:new Date("2026-11-03T00:00:00Z")},{now}),error=>error.code==="SUBSCRIPTION_REQUIRED");
});

test("검색량은 구독이 없어도 무료 한도를 적용하고 유료 3단계는 서버 카탈로그 한도를 적용한다",()=>{
  assert.deepEqual(resolveBrandSearchPlan(null,{now}),{planId:"free-search",planLabel:"검색량 무료",status:"active",priceKrw:0,runLimit:30,keywordLookupLimit:300});
  const periodEnd=new Date("2026-12-01T00:00:00Z");
  const starter=resolveBrandSearchPlan({planId:"starter",status:"active",periodEnd,runLimit:999_999},{now});
  const standard=resolveBrandSearchPlan({planId:"standard",status:"active",periodEnd},{now});
  const premium=resolveBrandSearchPlan({planId:"premium",status:"active",periodEnd},{now});
  assert.deepEqual([starter.priceKrw,standard.priceKrw,premium.priceKrw],[19_900,59_900,129_000]);
  assert.deepEqual([starter.runLimit,standard.runLimit,premium.runLimit],[100,300,1_000]);
  assert.deepEqual([starter.keywordLookupLimit,standard.keywordLookupLimit,premium.keywordLookupLimit],[2_000,6_000,20_000]);
  assert.equal(resolveBrandSearchPlan({planId:"standard",status:"expired",periodEnd:new Date("2026-11-01T00:00:00Z")},{now}).planId,"free-search");
});

test("만료·누락·손상된 기간과 이용 불가 상태는 실패-닫힘으로 거부한다",()=>{
  for(const plan of [
    null,
    {status:"pending",periodEnd:new Date("2026-12-01T00:00:00Z")},
    {status:"active"},
    {status:"active",periodEnd:"2026-12-01"},
    {status:"active",periodEnd:new Date("invalid")},
    {status:"active",periodEnd:{toDate(){throw new Error("corrupt timestamp");}}},
    {status:"active",periodEnd:new Date("2026-11-03T00:00:00Z")},
    {status:"trialing",periodEnd:new Date("2026-11-02T23:59:59Z")}
  ])assert.throws(()=>assertUsableSubscription(plan,{now}),error=>error.code==="SUBSCRIPTION_REQUIRED"&&error.status===403);
});
