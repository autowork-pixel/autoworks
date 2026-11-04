import { createCorsHandler } from "./cors-handler.mjs";
import { createAccountDeletionHandler } from "./account-deletion-handler.mjs";
import { createAccountDeletionRepository } from "./account-deletion-repository.mjs";
import { createAdminHandler } from "./admin-handler.mjs";
import { createAdminRepository } from "./admin-repository.mjs";
import { createCredentialRepository } from "./credential-repository.mjs";
import { createCredentialService } from "./credential-service.mjs";
import { createCollabYouTubeService } from "./collab-youtube-service.mjs";
import { createCollabInstagramService } from "./collab-instagram-service.mjs";
import { createContentReferenceService } from "./content-reference-service.mjs";
import { createInfluencerCandidateService } from "./influencer-candidate-service.mjs";
import { createAiBlogService } from "./ai-blog-service.mjs";
import { createNaverVisibilityService } from "./naver-search-visibility-service.mjs";
import { createContentPackService } from "./content-pack-service.mjs";
import { createHandler } from "./handler.mjs";
import { createKmsKeyManager } from "./kms-key-manager.mjs";
import { createOAuthHandler } from "./oauth-handler.mjs";
import { createOAuthIdentityStore, createOAuthStateStore } from "./oauth-repository.mjs";
import { fetchKeywordVolume } from "./naver-searchad.mjs";
import { createFirestoreRecoverySource, createRecoveryScheduler } from "./recovery-scheduler.mjs";
import { createRecoveryHandler } from "./recovery-handler.mjs";
import { createRouter } from "./router.mjs";
import { createTaskDispatcher } from "./task-dispatcher.mjs";
import { createTaskIdentityVerifier } from "./task-identity.mjs";
import { createWorkerContextLoader, createWorkerContextRepository } from "./worker-context.mjs";
import { createWorkerHandler } from "./worker-handler.mjs";
import { createBillingHandler } from "./billing-handler.mjs";
import { createBillingRepository } from "./billing-repository.mjs";
import { createBillingService } from "./billing-service.mjs";
import { createTossBillingClient } from "./toss-billing-client.mjs";
import { createBillingRenewalService } from "./billing-renewal-service.mjs";
import { createBillingRenewalHandler } from "./billing-renewal-handler.mjs";
import { createBudgetAlertHandler } from "./budget-alert-handler.mjs";
import { createBudgetAlertRepository } from "./budget-alert-repository.mjs";
import { createBudgetAlertService } from "./budget-alert-service.mjs";

export function createApplication({ config, database, serverTimestamp, verifyIdToken, repository, runRepository, tasksClient, kmsClient, tokenVerifier, tokenIssuer, logger = console }) {
  const keyManager = createKmsKeyManager({ client: kmsClient, keyName: config.keyName });
  const credentialService = createCredentialService({
    keyManager,
    repository: createCredentialRepository({ database, serverTimestamp })
  });
  const collabYouTubeService = createCollabYouTubeService({ repository, keyManager });
  const collabInstagramService = createCollabInstagramService({ repository, keyManager });
  const contentReferenceService = createContentReferenceService({ repository, keyManager });
  const influencerCandidateService = createInfluencerCandidateService({ repository, keyManager });
  const aiBlogService = createAiBlogService({ repository, keyManager, model: config.openAiModel });
  const naverVisibilityService = createNaverVisibilityService({ repository, keyManager });
  const contentPackService = createContentPackService({ repository, keyManager, model: config.openAiModel });
  const taskDispatcher = createTaskDispatcher({
    client: tasksClient, projectId: config.projectId, location: config.location, queue: config.queue,
    workerUrl: config.serviceUrl, serviceAccountEmail: config.serviceAccountEmail, audience: config.workerAudience
  });
  const verifyTaskRequest = createTaskIdentityVerifier({
    tokenVerifier, audience: config.workerAudience, serviceAccountEmail: config.serviceAccountEmail
  });
  const publicHandler = createCorsHandler({
    allowedOrigins: config.allowedOrigins,
    handler: createHandler({ verifyIdToken, repository, credentialService, collabYouTubeService, collabInstagramService, contentReferenceService, influencerCandidateService, aiBlogService, naverVisibilityService, contentPackService, taskDispatcher, logger })
  });
  const contextLoader = createWorkerContextLoader({
    repository: createWorkerContextRepository({ database }), keyManager
  });
  const workerHandler = createWorkerHandler({
    verifyTaskRequest, contextLoader, provider: { fetchKeywordVolume }, repository: runRepository, logger
  });
  const scheduler = createRecoveryScheduler({
    source: createFirestoreRecoverySource({ database, serverTimestamp }), taskDispatcher
  });
  const recoveryHandler = createRecoveryHandler({ verifyTaskRequest, scheduler, logger });
  const oauthHandler = createOAuthHandler({
    configs: config.oauthProviders, stateStore: createOAuthStateStore({ database, serverTimestamp }),
    identityStore: createOAuthIdentityStore({ database, serverTimestamp }), tokenIssuer,
    allowedOrigins: config.allowedOrigins, logger
  });
  const adminHandler = createCorsHandler({ allowedOrigins: config.allowedOrigins, handler: createAdminHandler({ verifyIdToken, repository: createAdminRepository({ database, serverTimestamp }), logger }) });
  const accountDeletionHandler = createCorsHandler({ allowedOrigins: config.allowedOrigins, handler: createAccountDeletionHandler({ verifyIdToken, repository: createAccountDeletionRepository({ database, serverTimestamp }), logger }) });
  const billingRepository = config.tossBilling ? createBillingRepository({ database, serverTimestamp }) : null;
  const billingProvider = config.tossBilling ? createTossBillingClient({ secretKey:config.tossBilling.secretKey }) : null;
  const billingHandler = config.tossBilling ? createCorsHandler({ allowedOrigins: config.allowedOrigins, handler: createBillingHandler({ verifyIdToken, service: createBillingService({ repository:billingRepository, provider:billingProvider, keyManager, clientKey:config.tossBilling.clientKey, webOrigin:config.allowedOrigins[0] }), logger }) }) : null;
  const billingRenewalHandler = config.tossBilling ? createBillingRenewalHandler({ verifyTaskRequest, service:createBillingRenewalService({ repository:billingRepository, provider:billingProvider, keyManager }), logger }) : null;
  const budgetAlertHandler = config.budgetDisplayName ? createBudgetAlertHandler({ verifyTaskRequest, service: createBudgetAlertService({ repository: createBudgetAlertRepository({ database, serverTimestamp }), expectedBudgetDisplayName: config.budgetDisplayName }), logger }) : null;
  return createRouter({ publicHandler, workerHandler, recoveryHandler, budgetAlertHandler, oauthHandler, adminHandler, accountDeletionHandler, billingHandler, billingRenewalHandler });
}

