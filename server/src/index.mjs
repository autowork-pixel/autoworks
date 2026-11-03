import { createServer } from "node:http";
import { CloudTasksClient } from "@google-cloud/tasks";
import { KeyManagementServiceClient } from "@google-cloud/kms";
import { OAuth2Client } from "google-auth-library";
import { createApplication } from "./application.mjs";
import { database, repository, runLifecycleRepository, serverTimestamp, tokenIssuer, verifyIdToken } from "./firebase-repository.mjs";
import { readRuntimeConfig } from "./runtime-config.mjs";

const port = Number(process.env.PORT || 8080);
const config = readRuntimeConfig();
const handler = createApplication({
  config, database, serverTimestamp, verifyIdToken, repository, runRepository: runLifecycleRepository,
  tasksClient: new CloudTasksClient(), kmsClient: new KeyManagementServiceClient(), tokenVerifier: new OAuth2Client(), tokenIssuer
});
const server = createServer(handler);
server.listen(port, "0.0.0.0", () => console.log(JSON.stringify({ event: "server_started", port })));
