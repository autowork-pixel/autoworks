export const FREE_SEARCH_PLAN = Object.freeze({
  planId: "free-search",
  planLabel: "검색량 무료",
  status: "active",
  priceKrw: 0,
  runLimit: 30,
  keywordLookupLimit: 300
});

export const STANDARD_PLAN = Object.freeze({
  planId: "standard",
  planLabel: "스탠다드",
  priceKrw: 19_900,
  vatIncluded: true,
  runLimit: 100,
  keywordLookupLimit: 2_000
});

