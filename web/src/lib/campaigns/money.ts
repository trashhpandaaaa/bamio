/*
 * What campaign clips earn. A clip earns its views at the campaign's rate per 1,000 once it has
 * the campaign's minimum, never more than the most one clip can earn, in whole cents (rounded
 * down). A clipper earns only once their approved clips have the campaign's views in all, and
 * never more than the most one clipper can earn. The budget is shared in the order clips were approved: first approved, first paid,
 * until it runs out. Bamio pays clippers (from what the campaign's owner pays Bamio) and an admin writes each payment down; what a
 * clipper is owed is what they earned less what they've been paid.
 */

export type Terms = {
  rateCents: number;
  budgetCents: number;
  minViews: number;
  maxClipCents: number | null;
  /** The most one clipper can earn in the campaign (null: no cap). */
  maxClipperCents?: number | null;
  /** Views a clipper's approved clips need in all before any of them earn (0: none). */
  minClipperViews?: number;
};

/** An approved clip that counts (its clipper isn't blocked). */
export type CountedClip = { id: number; userId: string; views: number; approvedAt: number };

/** A recorded payment. `userId` null: to someone who has since deleted their account. */
export type Payout = { userId: string | null; amountCents: number };

export type ClipperTotals = { clips: number; views: number; earnedCents: number; paidCents: number; owedCents: number };

export type Settlement = {
  /** What each clip earned, after the budget. */
  clips: Map<number, number>;
  clippers: Map<string, ClipperTotals>;
  /**
   * How much of the budget is spoken for: per clipper what they earned or were paid, whichever
   * is more, plus payments to people who have since left.
   */
  spentCents: number;
  leftCents: number;
  views: number;
};

/** A clip's earnings before the budget is looked at. */
export function clipEarned(views: number, terms: Terms): number {
  if (!(views > 0) || views < terms.minViews) return 0;
  const earned = Math.floor((views * terms.rateCents) / 1000);
  return terms.maxClipCents === null ? earned : Math.min(earned, terms.maxClipCents);
}

export function settle(terms: Terms, clips: CountedClip[], payouts: Payout[]): Settlement {
  const former = payouts.reduce((sum, p) => (p.userId === null ? sum + p.amountCents : sum), 0);
  let left = Math.max(0, terms.budgetCents - former);
  const perClip = new Map<number, number>();
  const clippers = new Map<string, ClipperTotals>();
  const totals = (userId: string) => {
    let t = clippers.get(userId);
    if (!t) clippers.set(userId, (t = { clips: 0, views: 0, earnedCents: 0, paidCents: 0, owedCents: 0 }));
    return t;
  };

  // Each clipper's views in all: under the campaign's minimum, none of their clips earn yet.
  const reach = new Map<string, number>();
  for (const clip of clips) reach.set(clip.userId, (reach.get(clip.userId) ?? 0) + Math.max(0, clip.views));
  const qualifies = (userId: string) => (reach.get(userId) ?? 0) >= (terms.minClipperViews ?? 0);

  let views = 0;
  for (const clip of [...clips].sort((a, b) => a.approvedAt - b.approvedAt || a.id - b.id)) {
    const room = terms.maxClipperCents == null ? Infinity : Math.max(0, terms.maxClipperCents - (clippers.get(clip.userId)?.earnedCents ?? 0));
    const earned = qualifies(clip.userId) ? Math.min(clipEarned(clip.views, terms), left, room) : 0;
    left -= earned;
    perClip.set(clip.id, earned);
    const t = totals(clip.userId);
    t.clips += 1;
    t.views += clip.views;
    t.earnedCents += earned;
    views += clip.views;
  }
  for (const p of payouts) if (p.userId !== null) totals(p.userId).paidCents += p.amountCents;

  let spent = former;
  for (const t of clippers.values()) {
    t.owedCents = Math.max(0, t.earnedCents - t.paidCents);
    spent += Math.max(t.earnedCents, t.paidCents);
  }
  return { clips: perClip, clippers, spentCents: spent, leftCents: Math.max(0, terms.budgetCents - spent), views };
}

/** 1234 as "1,234"; 37200000 as "37.2M". For view counts on cards and leaderboards. */
export function compactNumber(n: number): string {
  return n < 10_000 ? Math.round(n).toLocaleString("en-US") : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}
