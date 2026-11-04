import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createBillingRenewalHandler } from "../src/billing-renewal-handler.mjs";

async function withServer(deps,callback){const server=http.createServer(createBillingRenewalHandler(deps));await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));try{await callback(`http://127.0.0.1:${server.address().port}`)}finally{await new Promise(resolve=>server.close(resolve))}}

test("OIDC 작업 신원만 정기결제 갱신을 실행한다",async()=>{let runs=0;await withServer({verifyTaskRequest:async()=>({subject:"scheduler"}),service:{runOnce:async()=>{runs+=1;return{examined:2,succeeded:1,failed:1,skipped:0}}}},async base=>{const response=await fetch(`${base}/internal/v1/billing-renewals:run`,{method:"POST"});assert.equal(response.status,200);assert.equal((await response.json()).succeeded,1)});assert.equal(runs,1)});

test("신원이 없으면 서비스 실행 전에 거부한다",async()=>{let called=false;await withServer({verifyTaskRequest:async()=>{throw new Error("invalid")},service:{runOnce:async()=>{called=true}}},async base=>{const response=await fetch(`${base}/internal/v1/billing-renewals:run`,{method:"POST"});assert.equal(response.status,401)});assert.equal(called,false)});

