import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getGenerationForViewer } from "@/lib/generations";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

// One generation with its inputs (for "Run again").
// Someone else's generation is reported as not found,
// so ids can't be probed.
export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    const { id } = await context.params;
    const generation = await getGenerationForViewer(auth.user, id);

    if (!generation) {
      return NextResponse.json(
        { error: "Generation not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ generation });
  } catch (error) {
    console.error("Read generation error:", error);

    return NextResponse.json(
      { error: "Failed to load generation" },
      { status: 500 }
    );
  }
}
