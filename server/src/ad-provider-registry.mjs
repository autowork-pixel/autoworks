import { mapGoogleAdsSearchStream } from "./google-ads-report.mjs";
import { mapKakaoMomentReport } from "./kakao-moment-report.mjs";
import { mapMetaAdsInsights } from "./meta-ads-report.mjs";

const mappers = Object.freeze({
  "meta-ads": mapMetaAdsInsights,
  "google-ads": mapGoogleAdsSearchStream,
  "kakao-moment": mapKakaoMomentReport
});

export function mapAdProviderResponse(provider, response, context = {}) {
  const mapper = mappers[provider];
  if (!mapper) throw new TypeError(`Unsupported ad provider: ${provider}`);
  return mapper(response, context);
}
