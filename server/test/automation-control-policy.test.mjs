import test from "node:test";
import assert from "node:assert/strict";
import { assertAutomationAllowed } from "../src/automation-control-policy.mjs";

test("운영 차단이 없으면 실행을 허용한다",()=>{
  assert.doesNotThrow(()=>assertAutomationAllowed(null));
  assert.doesNotThrow(()=>assertAutomationAllowed({blocked:false}));
});

test("예산·안전 차단 중에는 새 실행을 503으로 거부한다",()=>{
  assert.throws(()=>assertAutomationAllowed({blocked:true}),error=>error.code==="AUTOMATION_PAUSED"&&error.status===503);
});
