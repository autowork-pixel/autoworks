export function createBudgetAlertRepository({ database, serverTimestamp }) {
  if (!database || !serverTimestamp) throw new Error("Budget alert repository configuration is incomplete");
  return {
    async record(alert) {
      const control = database.doc("systemControls/automation");
      const event = database.doc(`systemControls/automation/budgetEvents/${alert.eventId}`);
      return database.runTransaction(async transaction => {
        const existing = await transaction.get(event);
        if (existing.exists) return { blocked: Boolean(existing.data().blocked), reused: true };
        const timestamp = serverTimestamp();
        transaction.set(event, {
          budgetDisplayName: alert.budgetDisplayName,
          costRatio: Math.round(alert.costRatio * 10_000) / 10_000,
          alertThresholdExceeded: alert.alertThresholdExceeded,
          costIntervalStart: alert.costIntervalStart,
          blocked: alert.shouldBlock,
          receivedAt: timestamp
        });
        if (alert.shouldBlock) transaction.set(control, {
          blocked: true,
          reason: "budget_threshold_100",
          source: "cloud-billing-budget",
          updatedAt: timestamp
        }, { merge: true });
        return { blocked: alert.shouldBlock, reused: false };
      });
    }
  };
}
