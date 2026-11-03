import test from "node:test";
import assert from "node:assert/strict";
import { assertUsableSubscription } from "../src/subscription-policy.mjs";

const now=new Date("2026-11-03T00:00:00Z");

test("활성·베타 구독은 서버 Timestamp의 미래 종료일이 있어야 실행할 수 있다",()=>{
  const timestamp={toDate:()=>new Date("2026-12-01T00:00:00Z")};
  assert.equal(assertUsableSubscription({status:"active",periodEnd:timestamp},{now}).status,"active");
  assert.equal(assertUsableSubscription({status:"trialing",periodEnd:new Date("2026-11-04T00:00:00Z")},{now}).status,"trialing");
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
