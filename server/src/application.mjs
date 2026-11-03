import { createCorsHandler } from "./cors-handler.mjs";
import { createCredentialRepository } from "./credential-repository.mjs";
import { createCredentialService } from "./credential-service.mjs";
import { createHandler } from "./handler.mjs";
import { createKmsKeyManager } from "./kms-key-manager.mjs";
import { fetchKeywordVolume } from "./naver-searchad.mjs";
import { createFirestoreRecoverySource, createRecoveryScheduler } from "./recovery-scheduler.mjs";
import { createRecoveryHandler } from "./recovery-handler.mjs";
import { createRouter } from "./router.mjs";
import { createTaskDispatcher } from "./task-dispatcher.mjs";
import { createTaskIdentityVerifier } from "./task-identity.mjs";
import { createWorkerContextLoader, createWorkerContextRepository } from "./worker-context.mjs";
import { createWorkerHandler } from "./worker-handler.mjs";

export function createApplication({ config, database, serverTimestamp, verifyIdToken, repository, runRepository, tasksClient, kmsClient, tokenVerifier, logger = console }) {
  const keyManager = createKmsKeyManager({ client: kmsClient, keyName: config.keyName });
  const credentialService = createCredentialService({
    keyManager,
    repository: createCredentialRepository({ database, serverTimestamp })
  });
  const taskDispatcher = createTaskDispatcher({
    client: tasksClient, projectId: config.projectId, location: config.location, queue: config.queue,
    workerUrl: config.serviceUrl, serviceAccountEmail: config.serviceAccountEmail, audience: config.workerAudience
  });
  const verifyTaskRequest = createTaskIdentityVerifier({
    tokenVerifier, audience: config.workerAudience, serviceAccountEmail: config.serviceAccountEmail
  });
  const publicHandler = createCorsHandler({
    allowedOrigins: config.allowedOrigins,
    handler: createHandler({ verifyIdToken, repository, credentialService, taskDispatcher, logger })
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
  return createRouter({ publicHandler, workerHandler, recoveryHandler });
}
