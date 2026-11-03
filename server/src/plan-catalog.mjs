export const FREE_SEARCH_PLAN = Object.freeze({
  planId: "free-search",
  planLabel: "검색량 무료",
  status: "active",
  priceKrw: 0,
  projectLimit: 1,
  runLimit: 30,
  keywordLookupLimit: 300
});

export const STARTER_PLAN = Object.freeze({
  planId: "starter",
  planLabel: "스타터",
  priceKrw: 19_900,
  vatIncluded: true,
  runLimit: 100,
  keywordLookupLimit: 2_000,
  projectLimit: 1
});

export const STANDARD_PLAN = Object.freeze({
  planId: "standard",
  planLabel: "스탠다드",
  priceKrw: 59_900,
  vatIncluded: true,
  runLimit: 300,
  keywordLookupLimit: 6_000,
  projectLimit: 3
});

export const PREMIUM_PLAN = Object.freeze({
  planId: "premium",
  planLabel: "프리미엄",
  priceKrw: 129_000,
  vatIncluded: true,
  runLimit: 1_000,
  keywordLookupLimit: 20_000,
  projectLimit: 10
});

export const PAID_PLANS = Object.freeze({
  starter: STARTER_PLAN,
  standard: STANDARD_PLAN,
  premium: PREMIUM_PLAN
});

