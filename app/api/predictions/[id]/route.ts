import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  applyPrediction,
  canViewGeneration,
  fetchPrediction,
  getGeneration,
} from "@/lib/generations";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(
  _request: Request,
  context: RouteContext
) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json(
        { error: "Prediction ID is required" },
        { status: 400 }
      );
    }

    // Only predictions started through this app, by the
    // caller (or visible to an admin), can be polled.
    const generation = await getGeneration(id);

    if (
      !generation ||
      !canViewGeneration(auth.user, generation)
    ) {
      return NextResponse.json(
        { error: "Prediction not found" },
        { status: 404 }
      );
    }

    const result = await fetchPrediction(id);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    const prediction = result.prediction;

    console.log("REPLICATE STATUS:", prediction.status);

    // IMPORTANT:
    // Never let history bookkeeping break polling.
    let costUsd: number | null = generation.costUsd;
    let savedOutput: string | null =
      generation.localOutputUrl;

    try {
      const applied = await applyPrediction(
        generation,
        prediction
      );

      costUsd = applied.costUsd;
      savedOutput = applied.localOutputUrl;
    } catch (historyError) {
      console.error(
        "Failed to update generation history:",
        historyError
      );
    }

    return NextResponse.json({
      success: true,
      prediction,
      status: prediction.status ?? null,

      // Permanent local file URL
      output: savedOutput || prediction.output || null,

      // Original Replicate output
      replicateOutput: prediction.output ?? null,

      error: prediction.error ?? null,

      predictTime:
        (prediction.metrics as { predict_time?: number })
          ?.predict_time ?? null,

      costUsd,
      model: generation.model,
    });
  } catch (error) {
    console.error("Prediction fetch error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Internal server error",
      },
      { status: 500 }
    );
  }
}
