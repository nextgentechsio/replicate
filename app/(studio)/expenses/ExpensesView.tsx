"use client";

import { useStudio } from "@/app/(studio)/_components/StudioProvider";
import { useApiData } from "@/app/(studio)/_components/useApiData";
import { Alert, formatCost } from "@/app/components/ui/primitives";
import { fetchExpenseReport } from "@/lib/client/data";
import type { SpendGroup, SpendTotal } from "@/lib/expenses";
import { canManageUsers } from "@/lib/roles";

// --------------------------------------------------
// EXPENSES (MongoDB ledger via /api/expenses)
// --------------------------------------------------

// Spend grouped by project or user
function GroupTable({
  title,
  groups,
}: {
  title: string;
  groups: SpendGroup[];
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="border-b border-line px-5 py-4 font-semibold">
        {title}
      </div>

      {!groups.length ? (
        <div className="p-8 text-center text-sm text-fg-subtle">
          No spend yet.
        </div>
      ) : (
        <div className="divide-y divide-line">
          {groups.map((group) => (
            <div
              key={group.id}
              className="flex items-center justify-between gap-3 px-5 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-fg">{group.name}</p>

                <p className="mt-0.5 text-xs text-fg-subtle">
                  {group.count} billed
                  {group.unpriced ? ` · ${group.unpriced} unpriced` : ""}
                </p>
              </div>

              <span className="text-sm text-fg">
                {formatCost(group.amountUsd)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ExpensesView() {
  const { currentUser } = useStudio();
  const isManagerView = canManageUsers(currentUser);

  const { data: report, error } = useApiData(
    fetchExpenseReport,
    "Unable to load expenses."
  );

  const cards: [string, SpendTotal | undefined][] = [
    ["This month", report?.totals.month],
    ["This week", report?.totals.week],
    ["Today", report?.totals.today],
    ["All time", report?.totals.allTime],
  ];

  const unpricedTotal = report?.totals.allTime.unpriced ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-fg-subtle">
          Spend
        </p>

        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-fg sm:text-[32px]">
          Expenses
        </h1>

        <p className="mt-1 text-sm text-fg-muted">
          {isManagerView
            ? "Workspace AI spend, from the expense ledger."
            : "Your AI spend, from the expense ledger."}
        </p>
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map(([title, total]) => (
          <div
            key={title}
            className="rounded-2xl border border-line bg-surface p-5"
          >
            <p className="text-xs text-fg-subtle">{title}</p>

            <p className="mt-3 text-2xl font-semibold">
              {formatCost(total?.amountUsd)}
            </p>

            <p className="mt-1 text-xs text-fg-subtle">
              {total ? `${total.count} billed` : ""}
            </p>
          </div>
        ))}
      </div>

      {unpricedTotal > 0 && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          {unpricedTotal} billed generation
          {unpricedTotal === 1 ? " has" : "s have"} no known price (model not
          in the price table) and {unpricedTotal === 1 ? "is" : "are"} counted
          as $0.
        </div>
      )}

      <div className={`grid gap-6 ${isManagerView ? "lg:grid-cols-2" : ""}`}>
        <GroupTable title="By project" groups={report?.byProject ?? []} />

        {isManagerView && (
          <GroupTable title="By user" groups={report?.byUser ?? []} />
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="border-b border-line px-5 py-4 font-semibold">
          Expense history
        </div>

        {!report ? (
          <div className="p-10 text-center text-sm text-fg-subtle">
            {error ? "Expenses could not be loaded." : "Loading expenses..."}
          </div>
        ) : !report.entries.length ? (
          <div className="p-10 text-center text-sm text-fg-subtle">
            No expenses yet.
          </div>
        ) : (
          <div className="divide-y divide-line">
            {report.entries.map((item) => (
              <div
                key={item.id}
                className="grid gap-3 px-5 py-4 md:grid-cols-5"
              >
                <span className="text-sm text-fg">{item.project}</span>

                <span className="text-sm text-fg-muted">{item.user}</span>

                <span className="truncate text-sm text-fg-muted">
                  {item.model}
                </span>

                <span className="text-xs text-fg-subtle">
                  {new Date(item.incurredAt).toLocaleString()}
                </span>

                <span className="text-right text-sm text-fg">
                  {item.amountUsd === null
                    ? "unpriced"
                    : formatCost(item.amountUsd)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
