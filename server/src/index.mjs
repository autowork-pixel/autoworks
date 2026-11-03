import { createServer } from "node:http";
import { createHandler } from "./handler.mjs";
import { repository, verifyIdToken } from "./firebase-repository.mjs";

const port = Number(process.env.PORT || 8080);
const server = createServer(createHandler({ verifyIdToken, repository }));
server.listen(port, "0.0.0.0", () => console.log(JSON.stringify({ event: "server_started", port })));
