import {
  expensesCollection,
  generationsCollection,
  type ExpenseDoc,
  type GenerationDoc,
} from "@/lib/mongodb";
import { canManageUsers } from "@/lib/roles";
import { currentNames } from "@/lib/names";
import type { StoredUser } from "@/lib/users";

// --------------------------------------------------
// EXPENSE LEDGER (MongoDB "expenses")
//
// One entry per succeeded generation, written by the
// server when the generation completes. Entries are
// keyed by generation id and only ever inserted, so a
// generation is billed at most once. Totals are
// aggregated in MongoDB, not in the browser.
// --------------------------------------------------

export type PublicExpense = {
  id: string;
  generationId: string;
  userId: string;
  user: string;
  projectId: string;
  project: string;
  model: string;
  amountUsd: number | null;
  incurredAt: string;
};

export type SpendTotal = {
  amountUsd: number;
  count: number;
  // Entries whose model has no known price
  unpriced: number;
};

export type SpendGroup = SpendTotal & {
  id: string;
  name: string;
};

export type ExpenseReport = {
  totals: {
    today: SpendTotal;
    week: SpendTotal;
    month: SpendTotal;
    allTime: SpendTotal;
  };
  byProject: SpendGroup[];
  byUser: SpendGroup[];
  entries: PublicExpense[];
};

function toPublicExpense(doc: ExpenseDoc): PublicExpense {
  return {
    id: doc._id,
    generationId: doc.generationId,
    userId: doc.userId,
    user: doc.userName,
    projectId: doc.projectId,
    project: doc.projectName,
    model: doc.model,
    amountUsd: doc.amountUsd,
    incurredAt: doc.incurredAt.toISOString(),
  };
}

// --------------------------------------------------
// WRITE
// --------------------------------------------------

export async function recordExpense(
  generation: GenerationDoc,
  amountUsd: number | null,
  incurredAt: Date
) {
  const entry: ExpenseDoc = {
    _id: generation._id,
    generationId: generation._id,
    userId: generation.userId,
    userName: generation.userName,
    projectId: generation.projectId,
    projectName: generation.projectName,
    provider: "replicate",
    model: generation.model,
    amountUsd,
    currency: "USD",
    pricingSource: "estimated",
    incurredAt,
    createdAt: new Date(),
  };

  // Insert-only: an existing entry is never changed
  await (await expensesCollection()).updateOne(
    { _id: entry._id },
    { $setOnInsert: entry },
    { upsert: true }
  );
}

// Adds ledger entries for succeeded generations that
// don't have one yet (e.g. completed before the ledger
// existed). Runs once per server process, server-side.
const globalForBackfill = globalThis as unknown as {
  expenseBackfillPromise?: Promise<void>;
};

async function backfillExpenses() {
  await (await generationsCollection())
    .aggregate([
      { $match: { status: "succeeded" } },
      {
        $project: {
          _id: 1,
          generationId: "$_id",
          userId: 1,
          userName: 1,
          projectId: 1,
          projectName: 1,
          provider: 1,
          model: 1,
          amountUsd: { $ifNull: ["$costUsd", null] },
          currency: { $literal: "USD" },
          pricingSource: { $literal: "estimated" },
          incurredAt: {
            $ifNull: ["$completedAt", "$createdAt"],
          },
          createdAt: "$$NOW",
        },
      },
      {
        $merge: {
          into: "expenses",
          on: "_id",
          whenMatched: "keepExisting",
          whenNotMatched: "insert",
        },
      },
    ])
    .toArray();
}

async function ensureBackfilled() {
  if (!globalForBackfill.expenseBackfillPromise) {
    globalForBackfill.expenseBackfillPromise =
      backfillExpenses().catch((error) => {
        globalForBackfill.expenseBackfillPromise = undefined;
        throw error;
      });
  }

  await globalForBackfill.expenseBackfillPromise;
}

// --------------------------------------------------
// READ
// --------------------------------------------------

function totalStages(match?: Record<string, unknown>) {
  return [
    ...(match ? [{ $match: match }] : []),
    {
      $group: {
        _id: null,
        amountUsd: {
          $sum: { $ifNull: ["$amountUsd", 0] },
        },
        count: { $sum: 1 },
        unpriced: {
          $sum: {
            $cond: [{ $eq: ["$amountUsd", null] }, 1, 0],
          },
        },
      },
    },
  ];
}

function groupStages(idField: string, nameField: string) {
  return [
    {
      $group: {
        _id: `$${idField}`,
        name: { $last: `$${nameField}` },
        amountUsd: {
          $sum: { $ifNull: ["$amountUsd", 0] },
        },
        count: { $sum: 1 },
        unpriced: {
          $sum: {
            $cond: [{ $eq: ["$amountUsd", null] }, 1, 0],
          },
        },
      },
    },
    { $sort: { amountUsd: -1 as const, name: 1 as const } },
  ];
}

const EMPTY_TOTAL: SpendTotal = {
  amountUsd: 0,
  count: 0,
  unpriced: 0,
};

function readTotal(rows: unknown): SpendTotal {
  const row = (rows as SpendTotal[] | undefined)?.[0];

  return row
    ? {
        amountUsd: row.amountUsd,
        count: row.count,
        unpriced: row.unpriced,
      }
    : EMPTY_TOTAL;
}

function readGroups(rows: unknown): SpendGroup[] {
  return (
    (rows as (SpendTotal & {
      _id: string;
      name: string;
    })[]) ?? []
  ).map((row) => ({
    id: row._id,
    name: row.name,
    amountUsd: row.amountUsd,
    count: row.count,
    unpriced: row.unpriced,
  }));
}

// Period starts come from the browser so "today" and
// "this week" follow the viewer's local timezone.
export async function getExpenseReport(
  actor: StoredUser,
  periods: { todayStart: Date; weekStart: Date; monthStart: Date },
  entryLimit = 500
): Promise<ExpenseReport> {
  await ensureBackfilled();

  const isManager = canManageUsers(actor);

  // Plain users only ever see their own spend
  const scope = isManager ? {} : { userId: actor.id };

  const expenses = await expensesCollection();

  const [result] = await expenses
    .aggregate([
      { $match: scope },
      {
        $facet: {
          today: totalStages({
            incurredAt: { $gte: periods.todayStart },
          }),
          week: totalStages({
            incurredAt: { $gte: periods.weekStart },
          }),
          month: totalStages({
            incurredAt: { $gte: periods.monthStart },
          }),
          allTime: totalStages(),
          byProject: groupStages("projectId", "projectName"),
          // Per-user breakdown is for managers only
          ...(isManager
            ? { byUser: groupStages("userId", "userName") }
            : {}),
        },
      },
    ])
    .toArray();

  const entries = await expenses
    .find(scope)
    .sort({ incurredAt: -1 })
    .limit(entryLimit)
    .toArray();

  const byProject = readGroups(result?.byProject);
  const byUser = readGroups(result?.byUser);
  const publicEntries = entries.map(toPublicExpense);

  // Show today's names after a rename
  const names = await currentNames(
    [...byProject.map((group) => group.id), ...entries.map((entry) => entry.projectId)],
    [...byUser.map((group) => group.id), ...entries.map((entry) => entry.userId)]
  );

  for (const entry of publicEntries) {
    entry.project = names.projects.get(entry.projectId) ?? entry.project;
    entry.user = names.users.get(entry.userId) ?? entry.user;
  }

  const rename = (groups: SpendGroup[], map: Map<string, string>) =>
    groups.map((group) => ({ ...group, name: map.get(group.id) ?? group.name }));

  return {
    totals: {
      today: readTotal(result?.today),
      week: readTotal(result?.week),
      month: readTotal(result?.month),
      allTime: readTotal(result?.allTime),
    },
    byProject: rename(byProject, names.projects),
    byUser: rename(byUser, names.users),
    entries: publicEntries,
  };
}
