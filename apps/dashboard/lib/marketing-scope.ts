import { MARKETING_LANES, type MarketingLane } from '@smge/shared';

// UI-only switch: keep existing Official data and API support intact.
export const HIDE_OFFICIAL_LANE = true;
const OFFICIAL_PAGES = ['/campaigns', '/conversations', '/analytics', '/integrations'];
export function isHiddenMarketingPage(pathname: string) {
  return (
    HIDE_OFFICIAL_LANE &&
    OFFICIAL_PAGES.some((path) => pathname === path || pathname.startsWith(`${path}/`))
  );
}
export const VISIBLE_MARKETING_LANES = MARKETING_LANES.filter(
  (lane) => !HIDE_OFFICIAL_LANE || lane !== 'OFFICIAL',
);
export function visibleLaneFilter(lane?: MarketingLane | string) {
  return HIDE_OFFICIAL_LANE ? 'OUTBOUND' : lane;
}
export function isVisibleLane(lane: MarketingLane | null) {
  return lane === null || VISIBLE_MARKETING_LANES.includes(lane);
}
