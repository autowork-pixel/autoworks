import { ApiError, privateIdempotencyId } from "./domain.mjs";
import { assertAutomationAllowed } from "./automation-control-policy.mjs";
import { assertUsableSubscription } from "./subscription-policy.mjs";
import { PAID_PLANS } from "./plan-catalog.mjs";
import { reserveUsageCapacity } from "./usage-policy.mjs";
import { authenticityDigest } from "./account-authenticity.mjs";

function period(now=new Date()){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit"}).format(now).slice(0,7)}
export function createAccountAuthenticityRepository({database,serverTimestamp}){
  return{
    async reserve({workspaceId,uid,input}){
      const workspace=database.doc(`workspaces/${workspaceId}`),project=workspace.collection("projects").doc(input.projectId),subscription=workspace.collection("subscriptions").doc("current"),access=workspace.collection("serverControls").doc("access"),control=database.doc("systemControls/automation"),requiredProvider=input.platform==="instagram"?"apify":"youtube",required=workspace.collection("providerCredentials").doc(requiredProvider),naver=workspace.collection("providerCredentials").doc("naver-search"),openai=workspace.collection("providerCredentials").doc("openai"),usage=workspace.collection("usage").doc(period()),request=workspace.collection("runRequests").doc(privateIdempotencyId(uid,input.idempotencyKey));
      return database.runTransaction(async tx=>{
        const [owner,projectDoc,planDoc,accessDoc,controlDoc,requiredDoc,naverDoc,openaiDoc,usageDoc,requestDoc]=await Promise.all([workspace,project,subscription,access,control,required,naver,openai,usage,request].map(ref=>tx.get(ref)));
        assertAutomationAllowed(controlDoc.exists?controlDoc.data():null);
        if(!owner.exists||owner.data().ownerUid!==uid)throw new ApiError("AUTH_REQUIRED","워크스페이스 권한을 확인할 수 없습니다.",403);
        if(!projectDoc.exists)throw new ApiError("INVALID_INPUT","프로젝트를 찾을 수 없습니다.",404);
        if(accessDoc.exists&&accessDoc.data().blocked===true)throw new ApiError("AUTH_REQUIRED","현재 실행할 수 없는 계정입니다.",403);
        const active=assertUsableSubscription(planDoc.exists?planDoc.data():null),plan=PAID_PLANS[active.planId];if(!plan)throw new ApiError("SUBSCRIPTION_REQUIRED","계정 진성도 분석은 유료 구독에서 사용할 수 있습니다.",403);
        const digest=authenticityDigest(input);if(requestDoc.exists){const previous=requestDoc.data();if(previous.requestDigest!==digest)throw new ApiError("INVALID_INPUT","같은 요청 식별자를 다른 조건에 사용할 수 없습니다.",409);return{runId:previous.runId,status:previous.status,reused:true}}
        if(!requiredDoc.exists||requiredDoc.data().status!=="active"||!requiredDoc.data().ciphertext)throw new ApiError("PROVIDER_CREDENTIAL_REQUIRED",`${requiredProvider==="apify"?"Apify":"YouTube"} API 연결이 필요합니다.`,409);
        const capacity=reserveUsageCapacity({plan,usage:usageDoc.data()||{},requestedKeywords:0,allowZeroKeywords:true}),run=workspace.collection("runs").doc(),reservation=workspace.collection("usageReservations").doc(run.id),timestamp=serverTimestamp();
        tx.set(run,{projectId:input.projectId,tool:"account-authenticity",toolLabel:"계정 진성도 분석",status:"running",inputSummary:{accountUrl:input.url,platform:input.platform},usagePeriod:usage.id,requestDocumentId:request.id,createdAt:timestamp,startedAt:timestamp});
        tx.set(reservation,{runId:run.id,status:"reserved",runs:1,keywordLookups:0,usagePeriod:usage.id,createdAt:timestamp});
        tx.set(usage,{runsReserved:capacity.nextRunsReserved,updatedAt:timestamp},{merge:true});
        tx.set(request,{runId:run.id,status:"running",requestDigest:digest,createdAt:timestamp});
        const optional=doc=>doc.exists&&doc.data().status==="active"&&doc.data().ciphertext?doc.data():null;
        return{runId:run.id,status:"running",reused:false,envelopes:{required:requiredDoc.data(),naver:input.enableSearchLift?optional(naverDoc):null,openai:input.enableAiBrand?optional(openaiDoc):null}};
      });
    },
    async finish({workspaceId,runId,result,errorCode,providerCalled}){
      const workspace=database.doc(`workspaces/${workspaceId}`),run=workspace.collection("runs").doc(runId),reservation=workspace.collection("usageReservations").doc(runId);
      return database.runTransaction(async tx=>{
        const [runDoc,reservationDoc]=await Promise.all([tx.get(run),tx.get(reservation)]);if(!runDoc.exists||!reservationDoc.exists||runDoc.data().tool!=="account-authenticity")throw new ApiError("INVALID_INPUT","실행을 찾을 수 없습니다.",404);
        if(runDoc.data().status!=="running"||reservationDoc.data().status!=="reserved")return{status:runDoc.data().status,reused:true};
        const usage=workspace.collection("usage").doc(reservationDoc.data().usagePeriod),usageDoc=await tx.get(usage),current=usageDoc.data()||{},reserved=Number(current.runsReserved||0);if(!Number.isSafeInteger(reserved)||reserved<1)throw new ApiError("USAGE_STATE_INVALID","사용량 상태를 확인할 수 없습니다.",503);
        const succeeded=Boolean(result),timestamp=serverTimestamp();if(succeeded)tx.set(workspace.collection("reports").doc(runId),{runId,projectId:runDoc.data().projectId,tool:"account-authenticity",status:"ready",title:"계정 진성도 분석",query:result.accountUrl,capturedAt:result.capturedAt,summary:`${result.assessment.verdict} · 광고 ${result.advertising.count}건`,result,createdAt:timestamp});
        tx.set(usage,{runsReserved:reserved-1,runs:Number(current.runs||0)+1,succeeded:Number(current.succeeded||0)+Number(succeeded),failed:Number(current.failed||0)+Number(!succeeded),accountAuthenticityCalls:Number(current.accountAuthenticityCalls||0)+Number(providerCalled),updatedAt:timestamp},{merge:true});
        tx.set(reservation,{status:"committed",actualRuns:1,accountAuthenticityCalls:Number(providerCalled),updatedAt:timestamp},{merge:true});
        tx.set(run,{status:succeeded?"succeeded":"failed",resultReportId:succeeded?runId:null,succeededItems:succeeded?1:0,failedItems:succeeded?0:1,errorCode:succeeded?null:errorCode||"PROVIDER_UNAVAILABLE",completedAt:timestamp,updatedAt:timestamp},{merge:true});
        tx.set(workspace.collection("runRequests").doc(runDoc.data().requestDocumentId),{status:succeeded?"succeeded":"failed",updatedAt:timestamp},{merge:true});
        return{status:succeeded?"succeeded":"failed",reused:false};
      });
    }
  };
}

