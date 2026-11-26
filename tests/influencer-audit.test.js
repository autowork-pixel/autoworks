import test from "node:test";
import assert from "node:assert/strict";
import { analyzeInfluencerPosts } from "../public/influencer-audit.js";

test("최근 3개월 최신 15개에서 광고를 세고 모든 광고 반등을 확인한다", () => {
  const posts = Array.from({ length: 16 }, (_, index) => ({ date: `2026-11-${String(25 - index).padStart(2, "0")}`, platform: "instagram", type: "reel", brand: "A", isAd: true, searchLiftPercent: index % 2 ? -4 : 12 }));
  posts.push({ date: "2026-07-01", platform: "youtube", type: "video", brand: "A", isAd: true, searchLiftPercent: 50 });
  const result = analyzeInfluencerPosts(posts, new Date("2026-11-26T00:00:00Z"));
  assert.equal(result.recentCount, 15);
  assert.equal(result.adCount, 15);
  assert.equal(result.reboundChecked, 15);
  assert.equal(result.reboundCount, 8);
  assert.equal(result.instagramReelsSample, 16);
  assert.equal(result.youtubeVideosSample, 1);
});

test("같은 날 같은 브랜드의 게시물은 각각 세고 중복 캠페인 검토 신호를 준다", () => {
  const result = analyzeInfluencerPosts([
    { date: "2026-11-20", platform: "youtube", type: "video", brand: "Samsung", isAd: true, searchLiftPercent: 102 },
    { date: "2026-11-20", platform: "youtube", type: "shorts", brand: "Samsung", isAd: true, searchLiftPercent: 102 },
    { date: "2026-11-18", platform: "youtube", type: "video", brand: "Maxim", isAd: true }
  ], new Date("2026-11-26T00:00:00Z"));
  assert.equal(result.adCount, 3);
  assert.equal(result.duplicateCampaignGroups, 1);
  assert.equal(result.reboundChecked, 2);
  assert.equal(result.reboundCount, 2);
});

test("잘못된 입력을 거부한다", () => {
  assert.throws(() => analyzeInfluencerPosts([{ date: "2026-02-30", platform: "instagram", type: "reel", isAd: true }]), /날짜/);
  assert.throws(() => analyzeInfluencerPosts([{ date: "2026-11-20", platform: "instagram", type: "reel", isAd: "yes" }]), /isAd/);
});
