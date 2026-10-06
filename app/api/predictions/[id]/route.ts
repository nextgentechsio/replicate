import { calculateReplicateCost } from "@/lib/replicate-cost";
import { NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(
  request: Request,
  context: RouteContext
) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json(
        { error: "Prediction ID is required" },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const model = searchParams.get("model") || "";

    const token = process.env.REPLICATE_API_TOKEN;

    if (!token) {
      return NextResponse.json(
        {
          error: "REPLICATE_API_TOKEN is missing in .env.local",
        },
        { status: 500 }
      );
    }

    const response = await fetch(
      `https://api.replicate.com/v1/predictions/${encodeURIComponent(id)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );

    const prediction = await response.json();

    console.log(
      "REPLICATE STATUS:",
      prediction?.status
    );

    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            prediction?.detail ||
            prediction?.error ||
            "Failed to fetch prediction",
        },
        { status: response.status }
      );
    }

    // IMPORTANT:
    // Never let cost calculation break prediction polling.
    let costUsd = null;

    if (
      prediction?.status === "succeeded" ||
      prediction?.status === "failed" ||
      prediction?.status === "canceled"
    ) {
      if (model) {
        try {
          costUsd = calculateReplicateCost(
            model,
            prediction
          );
        } catch (costError) {
          console.error(
            "Cost calculation error:",
            costError
          );

          costUsd = null;
        }
      }
    }

    return NextResponse.json({
      success: true,
      prediction,
      status: prediction?.status ?? null,
      output: prediction?.output ?? null,
      error: prediction?.error ?? null,
      predictTime:
        prediction?.metrics?.predict_time ?? null,
      costUsd,
      model,
    });
  } catch (error) {
    console.error(
      "Prediction fetch error:",
      error
    );

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