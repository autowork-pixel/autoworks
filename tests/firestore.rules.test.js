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
  await assertFails(setDoc(project, {
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
    await setDoc(doc(admin, "workspaces/workspace-a/paymentSummaries/current"), { status: "paid", amount: 9900, currency: "KRW" });
    await setDoc(doc(admin, "workspaces/workspace-a/paymentEvents/event-a"), { type: "PAYMENT_STATUS_CHANGED", eventId: "event-a" });
    await setDoc(doc(admin, "workspaces/workspace-a/billingCredentials/current"), { billingKey: "secret" });
    await setDoc(doc(admin, "workspaces/workspace-a/deletionRequests/current"), { status: "pending", requestedBy: "user-a" });
    await setDoc(doc(admin, "workspaces/workspace-a/subscriptions/current"), { planId: "beta", planLabel: "베타", status: "active", runLimit: 30, keywordLookupLimit: 300 });
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
  await assertFails(getDoc(doc(owner, "workspaces/workspace-a/serverControls/access")));
  await assertFails(getDoc(doc(owner, "workspaces/workspace-a/runInputs/run-a")));
  await assertFails(getDoc(doc(owner, "workspaces/workspace-a/runRequests/private-hash")));
  await assertFails(getDoc(doc(owner, "workspaces/workspace-a/usageReservations/run-a")));
  await assertFails(setDoc(doc(owner, "workspaces/workspace-a/runInputs/run-a"), { keywords: ["secret"] }));
  await assertSucceeds(getDoc(doc(owner, "workspaces/workspace-a/paymentSummaries/current")));
  await assertFails(getDoc(doc(owner, "workspaces/workspace-a/paymentEvents/event-a")));
  await assertFails(getDoc(doc(owner, "workspaces/workspace-a/billingCredentials/current")));
  await assertFails(getDoc(doc(owner, "workspaces/workspace-a/deletionRequests/current")));
  await assertFails(setDoc(doc(owner, "workspaces/workspace-a/deletionRequests/current"), { status: "completed" }));
  await assertFails(setDoc(doc(owner, "workspaces/workspace-a/paymentSummaries/current"), { status: "paid" }, { merge: true }));
  await assertSucceeds(getDoc(doc(owner, "workspaces/workspace-a/subscriptions/current")));
  await assertFails(setDoc(doc(owner, "workspaces/workspace-a/subscriptions/current"), { status: "active" }, { merge: true }));
});

test("두 고객의 실행·결과·구독은 양방향 격리되고 API 키는 소유자에게도 비공개다", async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    const admin = context.firestore();
    for (const [workspaceId, ownerUid, label] of [
      ["workspace-a", "user-a", "네이버"],
      ["workspace-b", "user-b", "카카오"],
    ]) {
      const root = `workspaces/${workspaceId}`;
      await setDoc(doc(admin, root), { ownerUid, name: `${label} 고객` });
      await setDoc(doc(admin, `${root}/projects/project-1`), { name: `${label} 프로젝트`, brandName: label, keywords: [label] });
      await setDoc(doc(admin, `${root}/runs/run-1`), { tool: "brand-search", status: "succeeded", inputSummary: `${label} 실행` });
      await setDoc(doc(admin, `${root}/reports/report-1`), { title: `${label} 결과`, status: "ready" });
      await setDoc(doc(admin, `${root}/usage/2026-11`), { runs: 1, keywordLookups: 1 });
      await setDoc(doc(admin, `${root}/subscriptions/current`), { planId: "free-search", status: "active" });
      await setDoc(doc(admin, `${root}/paymentSummaries/current`), { status: "none", amount: 0 });
      await setDoc(doc(admin, `${root}/providerCredentials/naver-searchad`), { ciphertext: `${label}-secret` });
      await setDoc(doc(admin, `${root}/runInputs/run-1`), { keywords: [`${label}-private`] });
    }
  });

  const userA = environment.authenticatedContext("user-a").firestore();
  const userB = environment.authenticatedContext("user-b").firestore();
  const readable = [
    "projects/project-1", "runs/run-1", "reports/report-1", "usage/2026-11",
    "subscriptions/current", "paymentSummaries/current",
  ];
  for (const path of readable) {
    await assertSucceeds(getDoc(doc(userA, `workspaces/workspace-a/${path}`)));
    await assertFails(getDoc(doc(userA, `workspaces/workspace-b/${path}`)));
    await assertSucceeds(getDoc(doc(userB, `workspaces/workspace-b/${path}`)));
    await assertFails(getDoc(doc(userB, `workspaces/workspace-a/${path}`)));
  }
  for (const path of ["providerCredentials/naver-searchad", "runInputs/run-1"]) {
    await assertFails(getDoc(doc(userA, `workspaces/workspace-a/${path}`)));
    await assertFails(getDoc(doc(userA, `workspaces/workspace-b/${path}`)));
    await assertFails(getDoc(doc(userB, `workspaces/workspace-a/${path}`)));
    await assertFails(getDoc(doc(userB, `workspaces/workspace-b/${path}`)));
  }
});

test("구독과 결제 요약이 아직 없어도 소유자는 빈 상태를 읽을 수 있다", async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "workspaces/workspace-a"), { ownerUid: "user-a" });
  });
  const owner = environment.authenticatedContext("user-a").firestore();
  const otherUser = environment.authenticatedContext("user-b").firestore();
  for (const path of ["subscriptions/current", "paymentSummaries/current"]) {
    const ownerResult = await assertSucceeds(getDoc(doc(owner, `workspaces/workspace-a/${path}`)));
    assert.equal(ownerResult.exists(), false);
    await assertFails(getDoc(doc(otherUser, `workspaces/workspace-a/${path}`)));
  }
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

test("관리자 claim은 운영 데이터를 읽지만 문의 답변과 API 키는 브라우저에서 변경·조회하지 못한다", async () => {
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
    await setDoc(doc(admin, "workspaces/workspace-a/runs/run-a"), { tool: "brand-search", status: "failed", errorCode: "PROVIDER_RATE_LIMIT" });
    await setDoc(doc(admin, "workspaces/workspace-a/subscriptions/current"), { planId: "beta", planLabel: "베타", status: "trialing", runLimit: 30, keywordLookupLimit: 300 });
    await setDoc(doc(admin, "workspaces/workspace-a/providerCredentials/naver"), { secret: "test" });
    await setDoc(doc(admin, "workspaces/workspace-a/auditLogs/audit-a"), { action: "inquiry.answered", createdAt: new Date() });
    await setDoc(doc(admin, "workspaces/workspace-a/paymentEvents/event-a"), { type: "PAYMENT_STATUS_CHANGED", eventId: "event-a" });
    await setDoc(doc(admin, "workspaces/workspace-a/billingCredentials/current"), { billingKey: "secret" });
    await setDoc(doc(admin, "workspaces/workspace-a/deletionRequests/current"), { status: "pending", requestedBy: "user-a" });
  });

  const operator = environment.authenticatedContext("operator-a", { admin: true }).firestore();
  await assertSucceeds(getDocs(collection(operator, "workspaces")));
  await assertSucceeds(getDoc(doc(operator, "workspaces/workspace-a/usage/2026-11")));
  await assertSucceeds(getDoc(doc(operator, "workspaces/workspace-a/runs/run-a")));
  await assertSucceeds(getDoc(doc(operator, "workspaces/workspace-a/subscriptions/current")));
  await assertSucceeds(getDoc(doc(operator, "workspaces/workspace-a/auditLogs/audit-a")));
  await assertSucceeds(getDoc(doc(operator, "workspaces/workspace-a/paymentEvents/event-a")));
  await assertFails(setDoc(doc(operator, "workspaces/workspace-a/inquiries/inquiry-a"), {
    reply: "내 결과에서 확인할 수 있습니다.",
    status: "answered",
    respondedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertFails(getDoc(doc(operator, "workspaces/workspace-a/providerCredentials/naver")));
  await assertFails(getDoc(doc(operator, "workspaces/workspace-a/billingCredentials/current")));
  await assertFails(getDoc(doc(operator, "workspaces/workspace-a/deletionRequests/current")));
  await assertFails(setDoc(doc(operator, "workspaces/workspace-a/deletionRequests/current"), { status: "completed" }, { merge: true }));
  await assertFails(setDoc(doc(operator, "workspaces/workspace-a/subscriptions/current"), { status: "active" }, { merge: true }));
  await assertFails(setDoc(doc(operator, "workspaces/workspace-a/auditLogs/audit-b"), { action: "forged" }));
  const owner = environment.authenticatedContext("user-a").firestore();
  await assertFails(getDoc(doc(owner, "workspaces/workspace-a/auditLogs/audit-a")));
});


