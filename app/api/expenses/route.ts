import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getExpenseReport } from "@/lib/expenses";

export const runtime = "nodejs";

const DAY_MS = 24 * 60 * 60 * 1000;

// Accept a client-supplied period start only if it's a
// valid date within a sane window; otherwise use UTC.
function periodStart(
  value: string | null,
  fallback: Date,
  maxAgeDays: number
): Date {
  const date = value ? new Date(value) : null;

  if (
    !date ||
    Number.isNaN(date.getTime()) ||
    date.getTime() > Date.now() + DAY_MS ||
    date.getTime() < Date.now() - maxAgeDays * DAY_MS
  ) {
    return fallback;
  }

  return date;
}

// Expense report for the signed-in user: their own spend,
// or everyone's for admins and the super admin.
// ?todayStart=&weekStart=&monthStart= (ISO, viewer's local
// midnights) define the period totals.
export async function GET(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(request.url);

    const now = new Date();
    const utcToday = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate()
      )
    );

    const report = await getExpenseReport(auth.user, {
      todayStart: periodStart(
        searchParams.get("todayStart"),
        utcToday,
        2
      ),
      weekStart: periodStart(
        searchParams.get("weekStart"),
        new Date(utcToday.getTime() - utcToday.getUTCDay() * DAY_MS),
        8
      ),
      monthStart: periodStart(
        searchParams.get("monthStart"),
        new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
        ),
        32
      ),
    });

    return NextResponse.json(report);
  } catch (error) {
    console.error("Expense report error:", error);

    return NextResponse.json(
      { error: "Failed to load expenses" },
      { status: 500 }
    );
  }
}
