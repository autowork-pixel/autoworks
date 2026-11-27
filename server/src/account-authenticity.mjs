import { createHash } from "node:crypto";
import { ApiError } from "./domain.mjs";

const idPattern=/^[A-Za-z0-9_-]{1,128}$/;
const negative=/(?:유료\s*광고|광고|협찬|ppl)\s*(?:❌|✖️?|❎|🚫|x\b|아님|아닙니다|아니에요|없음|없어요|없습니다|없이)|(?:❌|✖️?|🚫|노|비|무)\s*(?:광고|협찬)/gi;
const positive=/(?:#\s*(?:유료)?광고(?![가-힣])|[\[(【<]\s*(?:유료\s*)?광고\s*[\])】>]|유료\s*광고|광고\s*포함|협찬|제품\s*(?:무상\s*)?제공|제작\s*지원|원고료|#ad\b|#sponsored\b|sponsored|paid\s*partnership|유료\s*프로모션|#ppl\b)/i;
const genericComments=new Set(["nice","wow","good","great","cool","love","amazing","awesome","beautiful","perfect","좋아요","좋네요","대박","굿","최고","멋져요","예뻐요","짱","우와","잘보고가요","소통해요","맞팔해요"]);
const thresholds={instagram:{low:.01,veryLow:.004},youtube_long:{low:.012,veryLow:.005},youtube_short:{low:.006,veryLow:.0025}};

export function normalizeAccountUrl(value){
  let url;try{url=new URL(value)}catch{throw new ApiError("INVALID_INPUT","계정 URL을 확인해 주세요.")}
  if(url.protocol!=="https:"||url.username||url.password||url.port||url.hash||url.search)throw new ApiError("INVALID_INPUT","HTTPS 계정 URL만 입력해 주세요.");
  const host=url.hostname.toLowerCase(),parts=url.pathname.split("/").filter(Boolean);
  if(["instagram.com","www.instagram.com"].includes(host)&&parts.length===1&&/^[A-Za-z0-9._]{1,30}$/.test(parts[0])&&!new Set(["p","reel","reels","stories","explore","tv"]).has(parts[0].toLowerCase()))return{platform:"instagram",handle:parts[0],url:`https://www.instagram.com/${parts[0]}/`};
  if(["youtube.com","www.youtube.com"].includes(host)&&parts.length===1){
    if(/^@[A-Za-z0-9._-]{3,100}$/.test(parts[0]))return{platform:"youtube",handle:parts[0].slice(1),url:`https://www.youtube.com/${parts[0]}`};
  }
  if(["youtube.com","www.youtube.com"].includes(host)&&parts.length===2&&parts[0]==="channel"&&/^UC[A-Za-z0-9_-]{22}$/.test(parts[1]))return{platform:"youtube",channelId:parts[1],url:`https://www.youtube.com/channel/${parts[1]}`};
  throw new ApiError("INVALID_INPUT","인스타그램 계정 또는 YouTube 채널 URL을 입력해 주세요.");
}

export function normalizeAuthenticityInput(body){
  if(!body||typeof body!=="object"||Array.isArray(body)||!idPattern.test(body.projectId||"")||!/^[A-Za-z0-9_-]{16,128}$/.test(body.idempotencyKey||""))throw new ApiError("INVALID_INPUT","계정 분석 요청 정보가 올바르지 않습니다.");
  const account=normalizeAccountUrl(body.url);
  return{projectId:body.projectId,idempotencyKey:body.idempotencyKey,...account,enableSearchLift:body.enableSearchLift===true,enableAiBrand:body.enableAiBrand===true};
}
export function authenticityDigest(input){const{ idempotencyKey,...stable}=input;return createHash("sha256").update(JSON.stringify(stable)).digest("hex")}

const mean=values=>values.reduce((sum,value)=>sum+value,0)/values.length;
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length?sorted[Math.floor(sorted.length/2)]:0};
const engagement=post=>post.views>0&&post.likes!==null?(post.likes+post.comments)/post.views:null;
const percent=value=>`${(value*100).toFixed(2)}%`;
function commentQuality(comments){
  const texts=comments.map(c=>String(c.text||"").trim()).filter(Boolean).slice(0,250);const counts=new Map();let low=0,foreign=0,letters=0;
  for(const text of texts){const core=text.toLowerCase().replace(/[^\p{L}\p{N}]/gu,"");if(!core||/^[a-z]{1,3}$/.test(core)||genericComments.has(core))low++;const body=text.replace(/@[\w.]+/g,"");if(/\p{L}/u.test(body)){letters++;if(!/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(body))foreign++}if(core.length>=4)counts.set(core,(counts.get(core)||0)+1)}
  const duplicates=[...counts.values()].reduce((sum,count)=>sum+Math.max(0,count-1),0);
  return{total:texts.length,lowRatio:texts.length?low/texts.length:0,duplicateRatio:texts.length?duplicates/texts.length:0,foreignRatio:letters?foreign/letters:0};
}

export function evaluateAuthenticity({platform,followers,posts,comments=[],ownerReplies=0}){
  const valid=posts.filter(p=>p.views>0),groups=platform==="youtube"?[{label:"롱폼",threshold:thresholds.youtube_long,posts:valid.filter(p=>!p.isShort)},{label:"쇼츠",threshold:thresholds.youtube_short,posts:valid.filter(p=>p.isShort)}]:[{label:"릴스",threshold:thresholds.instagram,posts:valid}];
  const enough=groups.filter(g=>g.posts.length>=5).sort((a,b)=>b.posts.length-a.posts.length);const quality=commentQuality(comments);
  if(!enough.length)return{verdict:"판단 보류",fit:"검토 필요",score:null,avgViews:valid.length?Math.round(mean(valid.map(p=>p.views))):null,avgEngagement:null,followers,signals:[{score:0,text:"포맷별 유효 게시물이 5개 미만입니다."}],sample:{posts:valid.length,comments:quality.total,format:"표본 부족"}};
  for(const group of enough){group.top=[...group.posts].sort((a,b)=>b.views-a.views).slice(0,10);group.avgViews=mean(group.top.map(p=>p.views));const ers=group.top.map(engagement).filter(v=>v!==null);group.avgEngagement=ers.length?mean(ers):null}
  const main=enough[0],signals=[];let needsCheck=false;
  const erSignals=enough.map(group=>{const er=group.avgEngagement,t=group.threshold,label=`${group.label} 상위 ${group.top.length}개 반응도`;if(er===null)return{score:0,text:`${group.label} 좋아요 비공개로 반응도 계산 불가`};if(er<t.veryLow)return{score:3,text:`${label} ${percent(er)}로 매우 낮음`};if(er<t.low)return{score:2,text:`${label} ${percent(er)}로 낮음`};if(er>=t.low*3)return{score:-1,text:`${label} ${percent(er)}로 양호`};return{score:0,text:`${label} ${percent(er)}로 보통`}});
  const worst=Math.max(...erSignals.map(x=>x.score));let worstApplied=false;for(const signal of erSignals){if(signal.score===worst&&!worstApplied){worstApplied=true;signals.push(signal)}else signals.push({...signal,score:0})}
  if(followers>0){const ratio=main.avgViews/followers,low=main.avgEngagement!==null&&main.avgEngagement<main.threshold.low;if(ratio>=30){signals.push({score:low?2:1,text:`팔로워 대비 상위 조회수 평균 ${ratio.toFixed(1)}배`});needsCheck=true}else if(ratio>=5&&low)signals.push({score:1,text:`팔로워 대비 조회수 ${ratio.toFixed(1)}배이며 반응 낮음`})}
  for(const group of enough){if(group.posts.length<8)continue;const cutoff=median(group.posts.map(p=>p.views))*10,spikes=group.posts.filter(p=>p.views>=cutoff&&engagement(p)!==null),rest=group.posts.filter(p=>p.views<cutoff&&engagement(p)!==null);if(spikes.length&&spikes.length<=group.posts.length/3&&rest.length>=3){const baseline=median(rest.map(engagement));if(baseline>0&&mean(spikes.map(engagement))<baseline*.4)signals.push({score:2,text:`${group.label} 조회수 급등 게시물의 반응도가 평소의 40% 미만`})}}
  const liked=valid.filter(p=>p.likes!==null),likes=liked.reduce((n,p)=>n+p.likes,0),replies=liked.reduce((n,p)=>n+p.comments,0);if(likes>=500&&replies/likes<.003)signals.push({score:1,text:"좋아요 대비 댓글 비율이 0.3% 미만"});
  if(quality.total>=10){if(quality.lowRatio>=.6)signals.push({score:2,text:"댓글 60% 이상이 이모지·단순 칭찬"});else if(quality.lowRatio>=.4)signals.push({score:1,text:"댓글 40% 이상이 이모지·단순 칭찬"});else if(quality.lowRatio<.25)signals.push({score:-1,text:"내용 있는 댓글이 충분함"});if(quality.duplicateRatio>=.15)signals.push({score:1,text:"같은 문구 반복 댓글 15% 이상"});const korean=valid.filter(p=>/[가-힣]/.test(p.caption||"")).length>=valid.length*.3;if(korean&&quality.foreignRatio>=.5)signals.push({score:1,text:"한국어 계정의 외국어 댓글 50% 이상"});if(ownerReplies/quality.total>=.1)signals.push({score:-1,text:"작성자가 댓글 10% 이상에 답글"})}else signals.push({score:0,text:`댓글 표본 ${quality.total}개로 품질 판단 제외`});
  const score=signals.reduce((n,s)=>n+s.score,0),noEvidence=enough.every(g=>g.avgEngagement===null)&&quality.total<10;
  const verdict=noEvidence?"판단 보류":score>=4?"조회수 작업 의심":score>=2?"판단 보류":"진성 소통";
  return{verdict,fit:verdict==="조회수 작업 의심"?"부적합":verdict==="판단 보류"||needsCheck?"검토 필요":"적합",score,avgViews:Math.round(main.avgViews),avgEngagement:main.avgEngagement,followers,signals:signals.sort((a,b)=>b.score-a.score),sample:{posts:valid.length,comments:quality.total,format:main.label},needsCheck};
}

export function isAdPost(post){if(post.sponsored)return true;const cleaned=String(post.caption||"").split(/\n/).filter(line=>!/(?:문의|contact|business|e-?mail|메일)/i.test(line)).join("\n").replace(negative,"");return positive.test(cleaned)}
export function summarizeAds(posts,now=new Date()){
  const cutoff=new Date(now.getTime()-92*86400000);const recent=posts.filter(p=>p.date&&new Date(p.date)>=cutoff&&new Date(p.date)<=now).sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,30),ads=recent.filter(isAdPost);
  return{count:ads.length,checked:recent.length,ads:ads.map(p=>({date:String(p.date).slice(0,10),url:p.url,caption:String(p.caption||"").slice(0,1200),brand:null,liftPercent:null,liftStatus:"미확인"}))};
}

export function computeSearchLift(points,date){
  const day=new Date(`${date}T00:00:00Z`);if(!Number.isFinite(day.getTime()))return null;
  const before=points.filter(p=>{const t=new Date(`${p.period}T00:00:00Z`);return t<day&&t>=new Date(day.getTime()-7*86400000)}).map(p=>Number(p.ratio)).filter(Number.isFinite);
  const after=points.filter(p=>{const t=new Date(`${p.period}T00:00:00Z`);return t>=day&&t<=new Date(day.getTime()+3*86400000)}).map(p=>Number(p.ratio)).filter(Number.isFinite);
  if(before.length<5||after.length<3)return null;const baseline=mean(before);return baseline>0?Math.round((Math.max(...after)/baseline-1)*100):null;
}

