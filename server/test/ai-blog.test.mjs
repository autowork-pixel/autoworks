import assert from "node:assert/strict";
import test from "node:test";
import { aiBlogDigest, generateAiBlogDraft, normalizeAiBlogInput } from "../src/ai-blog.mjs";

const body={projectId:"project-a",topic:"콘텐츠 자동화",facts:"오토웍스는 검토용 초안을 만든다.",keywords:["마케팅","자동화"],contentType:"정보형",tone:"전문적",targetLength:1500,sourceDraft:"",idempotencyKey:"random-request-key-0001"};

test("AI 블로그 입력을 제한하고 멱등 키를 제외해 해시한다",()=>{const input=normalizeAiBlogInput(body);assert.deepEqual(input.keywords,["마케팅","자동화"]);assert.equal(aiBlogDigest(input),aiBlogDigest({...input,idempotencyKey:"other-request-key-0002"}));assert.throws(()=>normalizeAiBlogInput({...body,facts:""}),{code:"INVALID_INPUT"});assert.throws(()=>normalizeAiBlogInput({...body,targetLength:999}),{code:"INVALID_INPUT"})});

test("Responses API에 사실 경계를 전달하고 초안·토큰 사용량만 정규화한다",async()=>{let request;const result=await generateAiBlogDraft({input:normalizeAiBlogInput(body),apiKey:"customer-key",model:"gpt-6-astra",now:()=>new Date("2026-11-04T00:00:00Z"),fetchImpl:async(url,options)=>{request={url,options};return{ok:true,json:async()=>({output:[{content:[{type:"output_text",text:"# 검토용 초안\n내용"}]}],usage:{input_tokens:321,output_tokens:654}})}}});assert.equal(request.url,"https://api.openai.com/v1/responses");assert.equal(request.options.headers.authorization,"Bearer customer-key");const payload=JSON.parse(request.options.body);assert.equal(payload.model,"gpt-6-astra");assert.match(payload.instructions,/확인된 사실/);assert.equal(JSON.stringify(payload).includes("오토웍스는 검토용 초안을 만든다."),true);assert.deepEqual(result,{draft:"# 검토용 초안\n내용",model:"gpt-6-astra",generatedAt:"2026-11-04T00:00:00.000Z",inputTokens:321,outputTokens:654})});

test("제공자 오류 원문과 키를 노출하지 않는다",async()=>{await assert.rejects(()=>generateAiBlogDraft({input:normalizeAiBlogInput(body),apiKey:"private-key",model:"gpt-6-astra",fetchImpl:async()=>({ok:false,status:401,json:async()=>({error:{message:"private-key invalid"}})})}),error=>error.code==="PROVIDER_AUTH_FAILED"&&!error.message.includes("private-key"))});
