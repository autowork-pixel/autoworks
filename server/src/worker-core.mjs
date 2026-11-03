const publicProviderCodes = new Set([
  "PROVIDER_AUTH_FAILED",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_INVALID_RESPONSE",
  "PROVIDER_NO_DATA"
]);

function failureFor(keyword, error) {
  return {
    keyword,
    code: publicProviderCodes.has(error?.code) ? error.code : "PROVIDER_UNAVAILABLE",
    retryable: error?.code === "PROVIDER_RATE_LIMITED" || error?.code === "PROVIDER_UNAVAILABLE"
  };
}

export async function executeBrandSearchRun({ runId, input, credentials, provider, repository, now = () => new Date() }) {
  await repository.markRunning(runId, { keywordCount: input.keywords.length });
  const snapshots = [];
  const failures = [];
  for (const keyword of input.keywords) {
    try {
      const volume = await provider.fetchKeywordVolume({ credentials, keyword });
      snapshots.push({ ...volume, recordedAt: now() });
    } catch (error) {
      failures.push(failureFor(keyword, error));
    }
  }
  if (!snapshots.length) {
    await repository.failRun(runId, {
      errorCode: failures.some(item => item.retryable) ? "PROVIDER_UNAVAILABLE" : failures[0]?.code || "PROVIDER_UNAVAILABLE",
      failures,
      keywordLookups: input.keywords.length
    });
    return { status: "failed", snapshots: [], failures };
  }
  await repository.completeRun(runId, {
    snapshots,
    failures,
    keywordLookups: input.keywords.length,
    succeededKeywords: snapshots.length,
    failedKeywords: failures.length
  });
  return { status: "succeeded", snapshots, failures };
}
