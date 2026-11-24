const publicProviderCodes = new Set([
  "PROVIDER_AUTH_FAILED",
  "PROVIDER_RATE_LIMIT",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_INVALID_RESPONSE",
  "PROVIDER_NO_DATA"
]);

function failureFor(keyword, error) {
  return {
    keyword,
    code: publicProviderCodes.has(error?.code) ? error.code : "PROVIDER_UNAVAILABLE",
    retryable: error?.code === "PROVIDER_RATE_LIMIT" || error?.code === "PROVIDER_UNAVAILABLE"
  };
}

export async function executeBrandSearchRun({ workspaceId, runId, workerId, input, credentials, provider, repository, now = () => new Date() }) {
  if (typeof workspaceId !== "string" || !workspaceId) throw new TypeError("workspaceId is required");
  if (typeof workerId !== "string" || !workerId) throw new TypeError("workerId is required");
  await repository.markRunning(workspaceId, runId, { keywordCount: input.keywords.length, workerId });
  const volumes = [];
  const snapshots = [];
  const failures = [];
  for (const keyword of input.keywords) {
    try {
      volumes.push(await provider.fetchKeywordVolume({ credentials: credentials.searchAd, keyword }));
    } catch (error) {
      failures.push(failureFor(keyword, error));
    }
  }
  if (volumes.length) {
    try {
      const range = provider.trendDateRange({ now: now(), displayPeriodDays: input.displayPeriodDays });
      const trends = await provider.fetchSearchTrends({
        credentials: credentials.searchTrend, keywords: volumes.map(item => item.keyword),
        startDate: range.startDate, endDate: range.endDate
      });
      for (const volume of volumes) {
        try {
          snapshots.push({
            ...volume,
            displayPeriodDays: input.displayPeriodDays,
            daily: provider.estimateDailyVolumes({
              volume, trend: trends.get(volume.keyword), displayPeriodDays: input.displayPeriodDays,
              roundingUnit: input.roundingUnit, endDate: range.endDate
            }),
            recordedAt: now()
          });
        } catch (error) {
          failures.push(failureFor(volume.keyword, error));
        }
      }
    } catch (error) {
      for (const volume of volumes) failures.push(failureFor(volume.keyword, error));
    }
  }
  if (!snapshots.length) {
    const retryable = failures.some(item => item.retryable);
    const outcome = await repository.failRun(workspaceId, runId, {
      errorCode: retryable ? "PROVIDER_UNAVAILABLE" : failures[0]?.code || "PROVIDER_UNAVAILABLE",
      failures, keywordLookups: input.keywords.length, workerId, retryable
    });
    return { status: outcome?.status || "failed", snapshots: [], failures };
  }
  await repository.completeRun(workspaceId, runId, {
    snapshots, failures, keywordLookups: input.keywords.length,
    succeededKeywords: snapshots.length, failedKeywords: failures.length, workerId
  });
  return { status: "succeeded", snapshots, failures };
}
