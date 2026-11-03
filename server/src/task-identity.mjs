const bearerPattern = /^Bearer\s+(.+)$/i;

export function createTaskIdentityVerifier({ tokenVerifier, audience, serviceAccountEmail }) {
  if (!tokenVerifier || !audience || !serviceAccountEmail) throw new Error("Task identity verifier configuration is incomplete");
  return async function verifyTaskRequest(request) {
    const authorization = request.headers?.authorization;
    const match = typeof authorization === "string" && authorization.match(bearerPattern);
    if (!match) throw new Error("Missing task identity token");
    const ticket = await tokenVerifier.verifyIdToken({ idToken: match[1], audience });
    const payload = ticket.getPayload();
    if (!payload?.sub || payload.email !== serviceAccountEmail || payload.email_verified !== true) {
      throw new Error("Unexpected task identity");
    }
    return { subject: payload.sub, email: payload.email };
  };
}
