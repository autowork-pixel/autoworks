export function createAccountDeletionPurgeService({ repository, logger = console }) {
  if (!repository) throw new Error("Account deletion purge service configuration is incomplete");
  return {
    async runOnce({ limit = 20, requestId = "account-deletion-purge" } = {}) {
      const pending = await repository.listPending(limit);
      let succeeded = 0, failed = 0, deletedCredentialCount = 0;
      for (const item of pending) {
        try {
          const result = await repository.purgeCredentials(item.workspaceId);
          deletedCredentialCount += Number(result.deletedCredentialCount || 0);
          succeeded += 1;
        } catch {
          failed += 1;
          logger.error("account_deletion_credential_purge_failed", { requestId, code: "INTERNAL_ERROR" });
        }
      }
      return { examined: pending.length, succeeded, failed, deletedCredentialCount };
    }
  };
}

