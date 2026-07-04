import { fmtEur } from "../format";

/**
 * Cash vs card for the current month: one horizontal stacked bar with a 2px
 * surface gap between segments, plus visible direct labels (relief rule —
 * the aqua slot is < 3:1 on the light surface, so values are always printed).
 */
export default function CashCardSplit({ cash, card }: { cash: number; card: number }) {
  const total = cash + card;
  const cashPct = total > 0 ? (cash / total) * 100 : 0;
  const cardPct = total > 0 ? (card / total) * 100 : 0;

  if (total <= 0) {
    return <p className="text-sm text-[var(--ink-muted)]">Δεν υπάρχουν εισπράξεις αυτόν τον μήνα.</p>;
  }

  return (
    <div>
      <div className="flex h-5 w-full gap-[2px] overflow-hidden rounded-full">
        <div style={{ width: `${cashPct}%`, background: "var(--series-1)" }} className="rounded-l-full" />
        <div style={{ width: `${cardPct}%`, background: "var(--series-2)" }} className="rounded-r-full" />
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--series-1)" }} />
          Μετρητά: <strong>{fmtEur(cash)}</strong>
          <span className="text-[var(--ink-muted)]">({cashPct.toFixed(0)}%)</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--series-2)" }} />
          Κάρτα: <strong>{fmtEur(card)}</strong>
          <span className="text-[var(--ink-muted)]">({cardPct.toFixed(0)}%)</span>
        </span>
      </div>
    </div>
  );
}
