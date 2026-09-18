import type { PublicParticipant, CardValue } from "../../../shared/types.ts";

const FANDP_RANK: Record<string, number> = {
  XS: 1,
  S: 2,
  M: 3,
  L: 4,
  XL: 5,
  XXL: 6,
};

/** Rank used for min/max comparison; null for values that don't rank ("?" / coffee). */
export function estimateRank(card: CardValue): number | null {
  if (card === "?" || card === "coffee") return null;
  const fan = FANDP_RANK[card];
  if (fan !== undefined) return fan;
  const numeric = Number(card);
  return Number.isFinite(numeric) ? numeric : null;
}

export interface OutlierPick {
  highestId: string;
  lowestId: string;
}

interface RankedCandidate {
  id: string;
  rank: number;
  connected: boolean;
}

/**
 * Pick one participant for the optimistic (lowest) and one for the
 * pessimistic (highest) estimate, ignoring "?" and coffee votes. Ties are
 * resolved randomly, preferring online participants (falling back to offline
 * candidates when nobody in the tie is online). Returns null when there is no
 * rankable vote or no spread (all estimates identical).
 */
export function pickOutliers(participants: PublicParticipant[]): OutlierPick | null {
  const ranked: RankedCandidate[] = [];
  for (const p of participants) {
    if (!p.hasSelected || !p.selectedCard) continue;
    const rank = estimateRank(p.selectedCard);
    if (rank === null) continue;
    ranked.push({ id: p.id, rank, connected: p.connected });
  }
  if (ranked.length === 0) return null;

  const first = ranked[0];
  if (!first) return null;

  let highest = first;
  let lowest = first;
  for (const candidate of ranked) {
    if (candidate.rank > highest.rank) highest = candidate;
    if (candidate.rank < lowest.rank) lowest = candidate;
  }
  if (highest.rank === lowest.rank) return null;

  return {
    highestId: pickAmong(ranked, (c) => c.rank === highest.rank),
    lowestId: pickAmong(ranked, (c) => c.rank === lowest.rank),
  };
}

function pickAmong(ranked: RankedCandidate[], matches: (c: RankedCandidate) => boolean): string {
  const all = ranked.filter(matches);
  const online = all.filter((c) => c.connected);
  const pool = online.length > 0 ? online : all;
  return (pool[Math.floor(Math.random() * pool.length)] as RankedCandidate).id;
}

const CACHE_LIMIT = 20;
const CACHE = new Map<string, OutlierPick>();

/**
 * Like {@link pickOutliers} but memoised per round so re-renders (timers,
 * presence updates) don't re-roll the random pick mid-round. Cleared naturally
 * when a new round supplies a new roundId.
 */
export function outliersForRound(
  participants: PublicParticipant[],
  roundId: string,
): OutlierPick | null {
  const cached = CACHE.get(roundId);
  if (cached) return cached;

  const pick = pickOutliers(participants);
  if (pick) {
    if (CACHE.size >= CACHE_LIMIT) {
      const oldest = CACHE.keys().next().value;
      if (oldest !== undefined) CACHE.delete(oldest);
    }
    CACHE.set(roundId, pick);
  }
  return pick;
}

/** Test helper: forget all cached round picks. */
export function clearEstimateCache(): void {
  CACHE.clear();
}