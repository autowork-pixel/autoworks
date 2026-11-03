import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { createAccountDeletionHandler } from "../src/account-deletion-handler.mjs";

async function withServer(dependencies, callback) { const server=createServer(createAccountDeletionHandler(dependencies)); server.listen(0,"127.0.0.1"); await once(server,"listening"); try { await callback(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); await once(server,"close"); } }
const request=(base, body={workspaceId:"workspace-a",confirmation:"DELETE"})=>fetch(`${base}/v1/account-deletion-requests`,{method:"POST",headers:{authorization:"Bearer token","content-type":"application/json"},body:JSON.stringify(body)});

test("로그인한 소유자의 명시적 탈퇴 확인만 저장소에 전달한다",async()=>{let received;await withServer({verifyIdToken:async()=>({uid:"user-a"}),repository:{requestDeletion:async value=>{received=value;return{status:"pending",reused:false}}}},async base=>{const response=await request(base);assert.equal(response.status,202);assert.equal(received.workspaceId,"workspace-a");assert.equal(received.uid,"user-a")})});
test("확인 문구가 없으면 탈퇴 요청을 저장하지 않는다",async()=>{let called=false;await withServer({verifyIdToken:async()=>({uid:"user-a"}),repository:{requestDeletion:async()=>{called=true}}},async base=>{const response=await request(base,{workspaceId:"workspace-a",confirmation:"delete"});assert.equal(response.status,400);assert.equal(called,false)})});
test("인증되지 않은 요청은 탈퇴 요청을 저장하지 않는다",async()=>{let called=false;await withServer({verifyIdToken:async()=>{throw new Error("invalid")},repository:{requestDeletion:async()=>{called=true}}},async base=>{const response=await request(base);assert.equal(response.status,401);assert.equal(called,false)})});
test("소유자의 탈퇴 처리 상태만 조회한다",async()=>{let received;await withServer({verifyIdToken:async()=>({uid:"user-a"}),repository:{getDeletionStatus:async value=>{received=value;return{status:"pending"}}}},async base=>{const response=await fetch(`${base}/v1/account-deletion-requests/workspace-a`,{headers:{authorization:"Bearer token"}});assert.equal(response.status,200);assert.equal((await response.json()).status,"pending");assert.deepEqual(received,{workspaceId:"workspace-a",uid:"user-a"})})});
