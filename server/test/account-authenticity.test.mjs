import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAuthenticityInput, evaluateAuthenticity, summarizeAds, computeSearchLift } from "../src/account-authenticity.mjs";
import { analyzeAccount } from "../src/account-authenticity-client.mjs";

test("계정 URL은 허용된 공개 프로필 도메인과 경로만 받는다",()=>{
  const base={projectId:"project_1",idempotencyKey:"abcdefghijklmnop"};
  assert.equal(normalizeAuthenticityInput({...base,url:"https://www.instagram.com/example/"}).handle,"example");
  assert.equal(normalizeAuthenticityInput({...base,url:"https://youtube.com/@example"}).platform,"youtube");
  for(const url of ["http://instagram.com/example","https://instagram.com/p/abc","https://instagram.com.evil.test/example","https://youtube.com/@example?x=1"])
    assert.throws(()=>normalizeAuthenticityInput({...base,url}),{code:"INVALID_INPUT"});
});

test("반응 표본 부족과 광고 검색 반등을 구분한다",()=>{
  assert.equal(evaluateAuthenticity({platform:"instagram",followers:100,posts:[{views:10,likes:1,comments:0}]}).verdict,"판단 보류");
  const ads=summarizeAds([{date:"2026-11-20",caption:"#광고 #구론산",url:"https://instagram.com/p/1"},{date:"2026-11-19",caption:"광고 아님",url:"https://instagram.com/p/2"}],new Date("2026-11-27T00:00:00Z"));
  assert.equal(ads.count,1);
  const points=Array.from({length:11},(_,index)=>({period:new Date(Date.UTC(2026,10,13+index)).toISOString().slice(0,10),ratio:index===8?20:10}));
  assert.equal(computeSearchLift(points,"2026-11-20"),100);
});

test("YouTube 분석은 서버 키를 헤더에만 넣고 결과에 노출하지 않는다",async()=>{
  const requests=[],key="private-test-key";
  const fetchImpl=async(url,options)=>{requests.push({url:String(url),options});const path=new URL(url).pathname.split("/").at(-1);const result=path==="channels"?{items:[{id:"channel",statistics:{subscriberCount:"1000"},contentDetails:{relatedPlaylists:{uploads:"uploads"}}}]}:path==="playlistItems"?{items:Array.from({length:5},(_,i)=>({contentDetails:{videoId:`video${i}`}}))}:path==="videos"?{items:Array.from({length:5},(_,i)=>({id:`video${i}`,snippet:{liveBroadcastContent:"none",publishedAt:"2026-11-20T00:00:00Z",title:"일반 영상",description:""},statistics:{viewCount:"100",likeCount:"10",commentCount:"2"},contentDetails:{duration:"PT10M"}}))}:{items:[]};return{ok:true,json:async()=>result}};
  const result=await analyzeAccount({account:{platform:"youtube",handle:"example",url:"https://www.youtube.com/@example"},credentials:{youtube:{apiKey:key}},fetchImpl,now:()=>new Date("2026-11-27T00:00:00Z")});
  assert.equal(result.assessment.verdict,"진성 소통");
  assert.equal(result.advertising.count,0);
  assert.ok(requests.every(call=>!call.url.includes(key)&&call.options.headers["x-goog-api-key"]===key));
  assert.ok(!JSON.stringify(result).includes(key));
});

