import { ApiError } from "./domain.mjs";
import { FREE_SEARCH_PLAN, PAID_PLANS } from "./plan-catalog.mjs";

function endDate(value){
  try{
    if(value instanceof Date)return value;
    if(value&&typeof value.toDate==="function")return value.toDate();
  }catch{}
  return null;
}

export function assertUsableSubscription(plan,{now=new Date()}={}){
  if(!plan||!["trialing","active","canceled","past_due"].includes(plan.status)){
    throw new ApiError("SUBSCRIPTION_REQUIRED","이용 가능한 구독이 필요합니다.",403);
  }
  const accessEnd=endDate(plan.status==="past_due"?plan.graceEnd:plan.periodEnd);
  if(!(accessEnd instanceof Date)||!Number.isFinite(accessEnd.getTime())||accessEnd.getTime()<=now.getTime()){
    throw new ApiError("SUBSCRIPTION_REQUIRED","구독 이용 기간을 확인할 수 없습니다.",403);
  }
  return plan;
}

export function resolveBrandSearchPlan(plan,{now=new Date()}={}){
  if(!plan)return FREE_SEARCH_PLAN;
  try{
    const usable=assertUsableSubscription(plan,{now});
    const catalogPlan=PAID_PLANS[usable.planId];
    if(catalogPlan)return {...usable,...catalogPlan};
  }catch(error){
    if(error?.code!=="SUBSCRIPTION_REQUIRED")throw error;
  }
  return FREE_SEARCH_PLAN;
}
