import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { recordHeartbeat } from "@/lib/users";

export const runtime = "nodejs";

// Heartbeat from an open, visible app tab (see
// lib/presence.ts). Any signed-in user.
export async function POST() {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    await recordHeartbeat(auth.user.id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Presence heartbeat error:", error);
    return NextResponse.json({ error: "Heartbeat failed" }, { status: 500 });
  }
}
