import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  listGenerations,
  reconcilePending,
} from "@/lib/generations";

export const runtime = "nodejs";

// Generation history for the signed-in user.
// Users get their own records; admins and the super
// admin get everyone's.
export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    // Finish generations whose tab closed mid-way, so
    // their status and cost aren't stuck at "starting".
    try {
      await reconcilePending(auth.user);
    } catch (reconcileError) {
      console.error(
        "Reconcile pending generations error:",
        reconcileError
      );
    }

    return NextResponse.json({
      generations: await listGenerations(auth.user),
    });
  } catch (error) {
    console.error("List generations error:", error);

    return NextResponse.json(
      { error: "Failed to load history" },
      { status: 500 }
    );
  }
}
