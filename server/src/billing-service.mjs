import { randomUUID } from "node:crypto";
import { ApiError } from "./domain.mjs";
import { PAID_PLANS } from "./plan-catalog.mjs";
import { encryptCredentialPayload } from "./credential-crypto.mjs";

function id(value, name, min = 1, max = 128) { const text=String(value||"").trim(); if(text.length<min||text.length>max||!/^[A-Za-z0-9_-]+$/.test(text))throw new ApiError("INVALID_INPUT",`${name} 형식이 올바르지 않습니다.`); return text; }
function authKey(value) { const text=String(value||"").trim(); if(!text||text.length>300||/[\u0000-\u001f\u007f]/.test(text))throw new ApiError("INVALID_INPUT","authKey 형식이 올바르지 않습니다."); return text; }

function validateBilling(binding, expectedCustomerKey) {
  if (!binding || binding.customerKey !== expectedCustomerKey || typeof binding.billingKey !== "string" || !binding.billingKey || binding.billingKey.length > 200) throw new ApiError("PAYMENT_RESPONSE_INVALID", "결제수단 등록 결과가 요청과 일치하지 않습니다.", 502);
  return binding.billingKey;
}
function validatePayment(payment, session) {
  const approvedAt=new Date(payment?.approvedAt);
  if(!payment||payment.orderId!==session.orderId||payment.status!=="DONE"||payment.currency!=="KRW"||payment.totalAmount!==session.amount||typeof payment.paymentKey!=="string"||!payment.paymentKey||payment.paymentKey.length>200||!Number.isFinite(approvedAt.getTime()))throw new ApiError("PAYMENT_RESPONSE_INVALID","결제 승인 결과가 주문과 일치하지 않습니다.",502);
  return payment;
}

export function createBillingService({ repository, provider, keyManager, clientKey, webOrigin, randomUUIDImpl = randomUUID }) {
  if(!repository||!provider||!keyManager||typeof clientKey!=="string"||!clientKey||typeof webOrigin!=="string")throw new Error("Billing service configuration is incomplete");
  return {
    async createSession({ workspaceId, uid, planId, idempotencyKey }) {
      const plan=PAID_PLANS[planId]; if(!plan)throw new ApiError("INVALID_INPUT","지원하지 않는 요금제입니다.");
      const requestKey=id(idempotencyKey,"idempotencyKey",16,128),customerKey=randomUUIDImpl(),orderId=`aw_${randomUUIDImpl().replaceAll("-","")}`;
      const session=await repository.createSession({workspaceId,uid,plan,idempotencyKey:requestKey,customerKey,orderId,issueIdempotencyKey:randomUUIDImpl(),chargeIdempotencyKey:randomUUIDImpl()});
      const suffix=`workspaceId=${encodeURIComponent(workspaceId)}&sessionId=${encodeURIComponent(session.sessionId)}`;
      return {sessionId:session.sessionId,status:session.status,customerKey:session.customerKey,clientKey,planId:session.planId,amount:session.amount,orderName:`오토웍스 ${plan.planLabel} 월 구독`,successUrl:`${webOrigin}/billing-success.html?${suffix}`,failUrl:`${webOrigin}/billing-fail.html?${suffix}`,reused:session.reused};
    },
    async complete({ workspaceId, uid, sessionId, customerKey, authKey:oneTimeKey }) {
      id(sessionId,"sessionId"); id(customerKey,"customerKey",22,50); const key=authKey(oneTimeKey);
      const session=await repository.reserveCompletion({workspaceId,uid,sessionId,customerKey});
      if(session.reused)return{status:"active",reused:true};
      const plan=PAID_PLANS[session.planId]; if(!plan||plan.priceKrw!==session.amount)throw new ApiError("PAYMENT_STATE_INVALID","저장된 결제 금액을 확인할 수 없습니다.",503);
      try {
        const binding=await provider.issueBillingKey({authKey:key,customerKey:session.customerKey,idempotencyKey:session.issueIdempotencyKey});
        const billingKey=validateBilling(binding,session.customerKey);
        let payment;
        try { payment=await provider.charge({billingKey,customerKey:session.customerKey,amount:session.amount,orderId:session.orderId,orderName:`오토웍스 ${plan.planLabel} 월 구독`,idempotencyKey:session.chargeIdempotencyKey}); }
        catch(error) { if(error?.code!=="PAYMENT_TEMPORARILY_UNAVAILABLE")throw error; payment=await provider.findByOrderId(session.orderId); }
        validatePayment(payment,session);
        const generated=await keyManager.generateDataKey({workspaceId,provider:"toss-billing"});
        try { const envelope=encryptCredentialPayload({credentials:{billingKey,customerKey:session.customerKey},plaintextDataKey:generated.plaintextDataKey,encryptedDataKey:generated.encryptedDataKey,keyVersion:generated.keyVersion,provider:"toss-billing"}); return await repository.complete({workspaceId,uid,sessionId,plan,envelope,payment}); }
        finally { generated.plaintextDataKey.fill(0); }
      } catch(error) { await repository.fail({workspaceId,uid,sessionId,errorCode:error?.code||"INTERNAL_ERROR"}); throw error; }
    },
    cancel({workspaceId,uid}) { return repository.cancelSubscription({workspaceId,uid}); }
  };
}
