import assert from "node:assert/strict";
import test from "node:test";
import { createAdminRepository } from "../src/admin-repository.mjs";

class Ref { constructor(database,path){this.database=database;this.path=path} collection(name){return new Collection(this.database,`${this.path}/${name}`)} }
class Collection { constructor(database,path){this.database=database;this.path=path} doc(id=`auto-${++this.database.sequence}`){return new Ref(this.database,`${this.path}/${id}`)} }
function fakeDatabase(seed={}) { const values=new Map(Object.entries(seed)),writes=[];const database={sequence:0,doc:path=>new Ref(database,path),runTransaction:callback=>callback({get:async ref=>({exists:values.has(ref.path),data:()=>values.get(ref.path)}),set:(ref,value,options)=>{values.set(ref.path,options?.merge?{...(values.get(ref.path)||{}),...value}:value);writes.push([ref.path,value,options])}})};return{database,values,writes}; }

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
