const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function calendarDate(value) {
  if (typeof value !== "string" || !datePattern.test(value)) throw new Error("게시물 날짜는 YYYY-MM-DD 형식이어야 합니다.");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("올바르지 않은 게시물 날짜가 있습니다.");
  return parsed;
}

export function analyzeInfluencerPosts(posts, now = new Date()) {
  if (!Array.isArray(posts) || posts.length > 5000) throw new Error("게시물 배열은 최대 5,000개까지 입력할 수 있습니다.");
  const today = new Date(now);
  if (Number.isNaN(today.getTime())) throw new Error("기준일이 올바르지 않습니다.");
  const cutoff = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 3, today.getUTCDate()));
  const normalized = posts.map((post, index) => {
    if (!post || typeof post !== "object" || Array.isArray(post)) throw new Error(`${index + 1}번째 게시물이 올바르지 않습니다.`);
    const date = calendarDate(post.date);
    if (typeof post.isAd !== "boolean") throw new Error(`${index + 1}번째 isAd는 true 또는 false여야 합니다.`);
    const platform = String(post.platform || "").toLowerCase();
    if (!["instagram", "youtube"].includes(platform)) throw new Error(`${index + 1}번째 platform은 instagram 또는 youtube여야 합니다.`);
    const type = String(post.type || "").toLowerCase();
    const brand = String(post.brand || "").trim().slice(0, 120);
    const lift = post.searchLiftPercent == null ? null : Number(post.searchLiftPercent);
    if (lift !== null && (!Number.isFinite(lift) || lift < -100 || lift > 100000)) throw new Error(`${index + 1}번째 검색 반등률이 올바르지 않습니다.`);
    return { date: post.date, timestamp: date.getTime(), platform, type, brand, isAd: post.isAd, searchLiftPercent: lift };
  }).filter(post => post.timestamp <= today.getTime()).sort((a, b) => b.timestamp - a.timestamp);
  const recent = normalized.filter(post => post.timestamp >= cutoff.getTime()).slice(0, 15);
  const ads = recent.filter(post => post.isAd);
  const reels = normalized.filter(post => post.platform === "instagram" && post.type === "reel").slice(0, 30);
  const videos = normalized.filter(post => post.platform === "youtube").slice(0, 50);
  const duplicateGroups = new Map();
  for (const ad of ads) {
    if (!ad.brand) continue;
    const key = `${ad.date}|${ad.brand.toLocaleLowerCase()}`;
    duplicateGroups.set(key, (duplicateGroups.get(key) || 0) + 1);
  }
  return {
    cutoff: cutoff.toISOString().slice(0, 10), recentCount: recent.length, adCount: ads.length,
    reboundChecked: ads.filter(post => post.searchLiftPercent !== null).length,
    reboundCount: ads.filter(post => post.searchLiftPercent !== null && post.searchLiftPercent > 0).length,
    instagramReelsSample: reels.length, youtubeVideosSample: videos.length,
    duplicateCampaignGroups: [...duplicateGroups.values()].filter(count => count > 1).length,
    ads: ads.map(({ date, platform, type, brand, searchLiftPercent }) => ({ date, platform, type, brand, searchLiftPercent }))
  };
}
