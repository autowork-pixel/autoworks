import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  getDoc,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";

const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const environment = await initializeTestEnvironment({
  projectId: "demo-autoworks",
  firestore: { rules },
});

after(() => environment.cleanup());

test("워크스페이스 소유자만 고객 데이터를 읽고 쓸 수 있다", async () => {
  await environment.clearFirestore();
  const owner = environment.authenticatedContext("user-a").firestore();
  const otherUser = environment.authenticatedContext("user-b").firestore();
  const workspace = doc(owner, "workspaces/workspace-a");

  await assertSucceeds(setDoc(workspace, {
    ownerUid: "user-a",
    name: "브랜드 A",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(getDoc(workspace));
  await assertSucceeds(getDocs(query(
    collection(owner, "workspaces"),
    where("ownerUid", "==", "user-a"),
    limit(1)
  )));
  await assertFails(getDocs(collection(owner, "workspaces")));
  await assertFails(getDoc(doc(otherUser, "workspaces/workspace-a")));
  await assertFails(setDoc(doc(otherUser, "workspaces/workspace-b"), {
    ownerUid: "user-a",
    name: "가로챈 워크스페이스",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));

  const project = doc(owner, "workspaces/workspace-a/projects/project-a");
  await assertSucceeds(setDoc(project, {
    name: "검색량 모니터링",
    brandName: "브랜드 A",
    keywords: ["브랜드 A", "브랜드 A 검색량"],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(getDoc(project));
  await assertFails(getDoc(doc(otherUser, "workspaces/workspace-a/projects/project-a")));
});

test("실행·스냅샷·결과·사용량은 소유자에게만 읽기 전용이며 비밀정보는 서버 전용이다", async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    const admin = context.firestore();
    await setDoc(doc(admin, "workspaces/workspace-a"), { ownerUid: "user-a" });
    await setDoc(doc(admin, "workspaces/workspace-a/runs/run-a"), { tool: "brand-search", status: "succeeded", inputSummary: "브랜드 A 외 2개", createdAt: new Date() });
    await setDoc(doc(admin, "workspaces/workspace-a/searchSnapshots/snapshot-a"), { keyword: "브랜드 A", pc: 1200, mobile: 3400, recordedAt: new Date() });
    await setDoc(doc(admin, "workspaces/workspace-a/reports/report-a"), { title: "브랜드 검색량 결과", status: "ready", summary: "3개 키워드 조회", createdAt: new Date() });
    await setDoc(doc(admin, "workspaces/workspace-a/usage/2026-11"), { runs: 1, keywordLookups: 3, succeeded: 1, failed: 0 });
    await setDoc(doc(admin, "workspaces/workspace-a/providerCredentials/naver"), { secret: "test" });
    await setDoc(doc(admin, "workspaces/workspace-a/subscriptions/current"), { status: "active" });
  });

  const owner = environment.authenticatedContext("user-a").firestore();
  const otherUser = environment.authenticatedContext("user-b").firestore();
  const run = doc(owner, "workspaces/workspace-a/runs/run-a");
  await assertSucceeds(getDoc(run));
  await assertSucceeds(getDocs(collection(owner, "workspaces/workspace-a/runs")));
  await assertSucceeds(getDoc(doc(owner, "workspaces/workspace-a/searchSnapshots/snapshot-a")));
  await assertSucceeds(getDoc(doc(owner, "workspaces/workspace-a/reports/report-a")));
  await assertSucceeds(getDoc(doc(owner, "workspaces/workspace-a/usage/2026-11")));
  await assertFails(setDoc(run, { status: "changed" }));
  await assertFails(setDoc(doc(owner, "workspaces/workspace-a/usage/2026-11"), { runs: 999 }));
  await assertFails(getDoc(doc(otherUser, "workspaces/workspace-a/runs/run-a")));
  await assertFails(getDoc(doc(otherUser, "workspaces/workspace-a/reports/report-a")));
  await assertFails(getDoc(doc(owner, "workspaces/workspace-a/providerCredentials/naver")));
  await assertFails(getDoc(doc(owner, "workspaces/workspace-a/subscriptions/current")));
});

test("고객 문의는 소유자가 생성·조회하고 상태 변경은 서버만 할 수 있다", async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "workspaces/workspace-a"), { ownerUid: "user-a" });
  });

  const owner = environment.authenticatedContext("user-a").firestore();
  const otherUser = environment.authenticatedContext("user-b").firestore();
  const inquiry = doc(owner, "workspaces/workspace-a/inquiries/inquiry-a");
  await assertSucceeds(setDoc(inquiry, {
    subject: "결과 파일 문의",
    message: "결과 파일을 다시 확인하고 싶습니다.",
    status: "open",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }));
  await assertSucceeds(getDoc(inquiry));
  await assertSucceeds(getDocs(collection(owner, "workspaces/workspace-a/inquiries")));
  await assertFails(getDoc(doc(otherUser, "workspaces/workspace-a/inquiries/inquiry-a")));
  await assertFails(setDoc(inquiry, { status: "answered" }, { merge: true }));
});

test("관리자 claim은 운영 데이터만 읽고 문의 답변만 수정하며 API 키는 읽지 못한다", async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    const admin = context.firestore();
    await setDoc(doc(admin, "workspaces/workspace-a"), { ownerUid: "user-a", name: "고객 A" });
    await setDoc(doc(admin, "workspaces/workspace-a/inquiries/inquiry-a"), {
      subject: "사용 문의",
      message: "결과 확인 방법을 알려주세요.",
      status: "open",
      createdAt: new Date(),
      updatedAt: new Date()
    });
    await setDoc(doc(admin, "workspaces/workspace-a/usage/2026-11"), { runs: 2 });
    await setDoc(doc(admin, "workspaces/workspace-a/subscriptions/current"), { status: "trial" });
    await setDoc(doc(admin, "workspaces/workspace-a/providerCredentials/naver"), { secret: "test" });
  });

  const operator = environment.authenticatedContext("operator-a", { admin: true }).firestore();
  await assertSucceeds(getDocs(collection(operator, "workspaces")));
  await assertSucceeds(getDoc(doc(operator, "workspaces/workspace-a/usage/2026-11")));
  await assertSucceeds(getDoc(doc(operator, "workspaces/workspace-a/subscriptions/current")));
  await assertSucceeds(setDoc(doc(operator, "workspaces/workspace-a/inquiries/inquiry-a"), {
    reply: "내 결과에서 확인할 수 있습니다.",
    status: "answered",
    respondedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertFails(getDoc(doc(operator, "workspaces/workspace-a/providerCredentials/naver")));
  await assertFails(setDoc(doc(operator, "workspaces/workspace-a/subscriptions/current"), { status: "active" }, { merge: true }));
});

