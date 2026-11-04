export function createRouter({ publicHandler, workerHandler, recoveryHandler, budgetAlertHandler, oauthHandler, adminHandler, accountDeletionHandler, billingHandler, billingRenewalHandler }) {
  if (![publicHandler, workerHandler, recoveryHandler].every(handler => typeof handler === "function")) throw new Error("Router configuration is incomplete");
  return (request, response) => {
    if (/^\/v1\/auth\//.test(request.url || "") && oauthHandler) return oauthHandler(request, response);
    if (/^\/v1\/admin\//.test(request.url || "") && adminHandler) return adminHandler(request, response);
    if (/^\/v1\/account-deletion-requests(?:\/|$)/.test(request.url || "") && accountDeletionHandler) return accountDeletionHandler(request, response);
    if (/^\/v1\/workspaces\/[^/]+\/billing-sessions(?:\/|$)/.test(request.url || "") && billingHandler) return billingHandler(request, response);
    if (/^\/v1\/workspaces\/[^/]+\/subscription:cancel$/.test(request.url || "") && billingHandler) return billingHandler(request, response);
    if (request.url === "/internal/v1/recovery:run") return recoveryHandler(request, response);
    if (request.url === "/internal/v1/billing-renewals:run" && billingRenewalHandler) return billingRenewalHandler(request, response);
    if (request.url === "/internal/v1/budget-alerts:receive" && budgetAlertHandler) return budgetAlertHandler(request, response);
    if (/^\/internal\/v1\/workspaces\//.test(request.url || "")) return workerHandler(request, response);
    return publicHandler(request, response);
  };
}

