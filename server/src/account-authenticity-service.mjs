import { ApiError } from "./domain.mjs";
import { decryptCredentialPayload } from "./credential-crypto.mjs";
import { analyzeAccount } from "./account-authenticity-client.mjs";

export function createAccountAuthenticityService({repository,keyManager,analyze=analyzeAccount}){
  return{async run({workspaceId,uid,input}){
    const reserved=await repository.reserve({workspaceId,uid,input});if(reserved.reused)return reserved;let providerCalled=false;
    try{
      async function credential(provider,envelope){if(!envelope)return null;const key=await keyManager.decryptDataKey({workspaceId,provider,encryptedDataKey:envelope.encryptedDataKey,keyVersion:envelope.keyVersion});try{return decryptCredentialPayload({provider,envelope,plaintextDataKey:key})}finally{key.fill(0)}}
      const requiredProvider=input.platform==="instagram"?"apify":"youtube";
      const credentials={};credentials[requiredProvider]=await credential(requiredProvider,reserved.envelopes.required);
      credentials.naver=await credential("naver-search",reserved.envelopes.naver);credentials.openai=await credential("openai",reserved.envelopes.openai);
      providerCalled=true;const result=await analyze({account:input,credentials});const finished=await repository.finish({workspaceId,runId:reserved.runId,result,providerCalled});return{runId:reserved.runId,status:finished.status,reused:false,...result};
    }catch(error){const code=error instanceof ApiError?error.code:"PROVIDER_UNAVAILABLE";await repository.finish({workspaceId,runId:reserved.runId,errorCode:code,providerCalled});throw error}
  }};
}

