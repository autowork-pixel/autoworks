import assert from "node:assert/strict";
import test from "node:test";
import { createAdminRepository } from "../src/admin-repository.mjs";

class Ref { constructor(database,path){this.database=database;this.path=path} collection(name){return new Collection(this.database,`${this.path}/${name}`)} }
class Collection { constructor(database,path){this.database=database;this.path=path} doc(id=`auto-${++this.database.sequence}`){return new Ref(this.database,`${this.path}/${id}`)} }
function fakeDatabase(seed={}) { const values=new Map(Object.entries(seed)),writes=[];const database={sequence:0,doc:path=>new Ref(database,path),runTransaction:callback=>callback({get:async ref=>({exists:values.has(ref.path),data:()=>values.get(ref.path)}),set:(ref,value,options)=>{values.set(ref.path,options?.merge?{...(values.get(ref.path)||{}),...value}:value);writes.push([ref.path,value,options])}})};return{database,values,writes}; }

test("관리자 전역 재개는 차단 상태와 비민감 감사 기록을 한 트랜잭션에 남긴다", async () => {
  const fake=fakeDatabase({"systemControls/automation":{blocked:true,source:"cloud-billing-budget"}}),repository=createAdminRepository({database:fake.database,serverTimestamp:()=>"server-time"});
  const input={blocked:false,reason:"예산 원인 확인 및 운영자 재개 승인",actorUid:"admin-a",requestId:"request-a"};
  assert.deepEqual(await repository.setAutomationBlocked(input),{blocked:false,reused:false});
  assert.equal(fake.values.get("systemControls/automation").blocked,false);
  const audit=[...fake.values.entries()].find(([path,value])=>path.includes("/auditLogs/")&&value.action==="automation.resumed")[1];
  assert.equal(audit.actorUid,"admin-a");assert.deepEqual(audit.beforeSummary,{blocked:true});assert.deepEqual(audit.afterSummary,{blocked:false});
  const writes=fake.writes.length;assert.deepEqual(await repository.setAutomationBlocked(input),{blocked:false,reused:true});assert.equal(fake.writes.length,writes);
});

test("고객 차단과 감사 기록을 같은 트랜잭션에 남기고 반복 요청은 재사용한다", async () => {
  const fake=fakeDatabase({"workspaces/workspace-a":{ownerUid:"user-a"}}),repository=createAdminRepository({database:fake.database,serverTimestamp:()=>"server-time"});
  const input={workspaceId:"workspace-a",blocked:true,reason:"비정상 사용량 확인",actorUid:"admin-a",requestId:"request-a"};
  assert.deepEqual(await repository.setWorkspaceBlocked(input),{blocked:true,reused:false});
  assert.equal(fake.values.get("workspaces/workspace-a/serverControls/access").blocked,true);
  const audit=[...fake.values.entries()].find(([path])=>path.includes("/auditLogs/"))[1];
  assert.deepEqual(audit.beforeSummary,{blocked:false});assert.deepEqual(audit.afterSummary,{blocked:true});assert.equal(audit.actorUid,"admin-a");
  const writes=fake.writes.length;assert.deepEqual(await repository.setWorkspaceBlocked(input),{blocked:true,reused:true});assert.equal(fake.writes.length,writes);
});

test("없는 워크스페이스는 운영 조치 전에 거부한다", async () => {
  const fake=fakeDatabase(),repository=createAdminRepository({database:fake.database,serverTimestamp:()=>"server-time"});
  await assert.rejects(()=>repository.setWorkspaceBlocked({workspaceId:"missing",blocked:true,reason:"확인용 사유",actorUid:"admin-a",requestId:"request-a"}),error=>error.status===404);
  assert.equal(fake.writes.length,0);
});

test("문의 답변과 비민감 감사 기록을 같은 트랜잭션에 남긴다", async () => {
  const fake=fakeDatabase({"workspaces/workspace-a":{ownerUid:"user-a"},"workspaces/workspace-a/inquiries/inquiry-a":{status:"open",message:"원문 문의"}}),repository=createAdminRepository({database:fake.database,serverTimestamp:()=>"server-time"});
  const input={workspaceId:"workspace-a",inquiryId:"inquiry-a",reply:"내 결과에서 확인해 주세요.",actorUid:"admin-a",requestId:"request-a"};
  assert.deepEqual(await repository.answerInquiry(input),{status:"answered",reused:false});
  const inquiry=fake.values.get("workspaces/workspace-a/inquiries/inquiry-a");assert.equal(inquiry.status,"answered");assert.equal(inquiry.reply,input.reply);
  const audit=[...fake.values.entries()].find(([path,value])=>path.includes("/auditLogs/")&&value.action==="inquiry.answered")[1];
  assert.equal(audit.actorUid,"admin-a");assert.equal(JSON.stringify(audit).includes("원문 문의"),false);assert.equal(JSON.stringify(audit).includes(input.reply),false);
  const writes=fake.writes.length;assert.deepEqual(await repository.answerInquiry(input),{status:"answered",reused:true});assert.equal(fake.writes.length,writes);
});

test("문의 상태는 허용된 순서로만 바꾸고 사유를 감사 기록에 남긴다", async () => {
  const fake=fakeDatabase({"workspaces/workspace-a":{ownerUid:"user-a"},"workspaces/workspace-a/inquiries/inquiry-a":{status:"open"}}),repository=createAdminRepository({database:fake.database,serverTimestamp:()=>"server-time"});
  const common={workspaceId:"workspace-a",inquiryId:"inquiry-a",reason:"담당자가 확인을 시작함",actorUid:"admin-a",requestId:"request-a"};
  assert.deepEqual(await repository.updateInquiryStatus({...common,status:"reviewing"}),{status:"reviewing",reused:false});
  assert.equal(fake.values.get("workspaces/workspace-a/inquiries/inquiry-a").status,"reviewing");
  await assert.rejects(()=>repository.updateInquiryStatus({...common,status:"open"}),error=>error.status===409);
  assert.deepEqual(await repository.updateInquiryStatus({...common,status:"closed"}),{status:"closed",reused:false});
  await assert.rejects(()=>repository.answerInquiry({...common,reply:"늦은 답변"}),error=>error.status===409);
});
