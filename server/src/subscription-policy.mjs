import { ApiError } from "./domain.mjs";

function endDate(value){
  if(value instanceof Date)return value;
  if(value&&typeof value.toDate==="function")return value.toDate();
  return null;
}

export function assertUsableSubscription(plan,{now=new Date()}={}){
  if(!plan||!["trialing","active"].includes(plan.status)){
    throw new ApiError("SUBSCRIPTION_REQUIRED","이용 가능한 구독이 필요합니다.",403);
  }
  const periodEnd=endDate(plan.periodEnd);
  if(!(periodEnd instanceof Date)||!Number.isFinite(periodEnd.getTime())||periodEnd.getTime()<=now.getTime()){
    throw new ApiError("SUBSCRIPTION_REQUIRED","구독 이용 기간을 확인할 수 없습니다.",403);
  }
  return plan;
}
