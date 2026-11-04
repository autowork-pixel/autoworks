import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { createBillingHandler } from "../src/billing-handler.mjs";

async function server(dependencies,callback){const instance=createServer(createBillingHandler(dependencies));instance.listen(0,"127.0.0.1");await once(instance,"listening");try{await callback(`http://127.0.0.1:${instance.address().port}`)}finally{instance.close();await once(instance,"close")}}

test("로그인한 고객만 결제 등록 세션을 만들 수 있다",async()=>{let received;await server({verifyIdToken:async()=>({uid:"user-a"}),service:{createSession:async value=>{received=value;return{sessionId:"session-a",status:"pending",reused:false}}}},async base=>{const response=await fetch(`${base}/v1/workspaces/workspace-a/billing-sessions`,{method:"POST",headers:{authorization:"Bearer token","content-type":"application/json"},body:JSON.stringify({planId:"starter",idempotencyKey:"random-request-key-0001"})});assert.equal(response.status,201);assert.equal(received.uid,"user-a");assert.equal(received.workspaceId,"workspace-a")})});

test("토큰이 없으면 결제 서비스를 호출하지 않는다",async()=>{let called=false;await server({verifyIdToken:async()=>({uid:"user-a"}),service:{createSession:async()=>{called=true}}},async base=>{const response=await fetch(`${base}/v1/workspaces/workspace-a/billing-sessions`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"});assert.equal(response.status,401);assert.equal(called,false)})});
