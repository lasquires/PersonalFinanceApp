import type { SnapBalance, SnapPublicObservation } from '../types';

export function snapDisplay(trusted: SnapBalance[], publicObservations: SnapPublicObservation[], now = new Date()) {
  const accepted = publicObservations.filter(observation => !observation.flagged);
  const latestTrusted = [...trusted].sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))[0];
  const latestPublic = [...accepted].sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))[0];
  const unverified = Boolean(latestPublic && (!latestTrusted || Date.parse(latestPublic.observed_at) > Date.parse(latestTrusted.observed_at)));
  const balance = (unverified ? latestPublic : latestTrusted) ?? null;
  const flagged = publicObservations.some(observation => observation.flagged && (!balance || (observation.benefit_month === balance.benefit_month && Date.parse(observation.observed_at) > Date.parse(balance.observed_at))));
  const stale = !balance || now.getTime() - Date.parse(balance.observed_at) > 36 * 60 * 60_000;
  return { balance, unverified, flagged, stale };
}
