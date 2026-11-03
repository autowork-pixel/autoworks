export function createRouter({ publicHandler, workerHandler, recoveryHandler, oauthHandler }) {
  if (![publicHandler, workerHandler, recoveryHandler].every(handler => typeof handler === "function")) throw new Error("Router configuration is incomplete");
  return (request, response) => {
    if (/^\/v1\/auth\//.test(request.url || "") && oauthHandler) return oauthHandler(request, response);
    if (request.url === "/internal/v1/recovery:run") return recoveryHandler(request, response);
    if (/^\/internal\/v1\/workspaces\//.test(request.url || "")) return workerHandler(request, response);
    return publicHandler(request, response);
  };
}
