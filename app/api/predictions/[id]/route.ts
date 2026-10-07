import { calculateReplicateCost } from "@/lib/replicate-cost";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import fs from "fs/promises";
import path from "path";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

async function saveReplicateOutput(
  output: unknown,
  predictionId: string
) {
  if (!output) return null;

  const outputUrl =
    typeof output === "string"
      ? output
      : Array.isArray(output)
      ? output.find(
          (item): item is string =>
            typeof item === "string" &&
            /^https?:\/\//i.test(item)
        )
      : null;

  if (!outputUrl) return null;

  try {
    const response = await fetch(outputUrl);

    if (!response.ok) {
      console.error(
        "Failed to download Replicate output:",
        response.status
      );
      return null;
    }

    const contentType =
      response.headers.get("content-type") || "";

    let extension = ".bin";

    if (contentType.includes("image/png")) {
      extension = ".png";
    } else if (contentType.includes("image/jpeg")) {
      extension = ".jpg";
    } else if (contentType.includes("image/webp")) {
      extension = ".webp";
    } else if (contentType.includes("video/mp4")) {
      extension = ".mp4";
    } else if (contentType.includes("video/webm")) {
      extension = ".webm";
    }

    const historyDir = path.join(
      process.cwd(),
      "public",
      "history"
    );

    await fs.mkdir(historyDir, {
      recursive: true,
    });

    const fileName = `${predictionId}${extension}`;
    const filePath = path.join(
      historyDir,
      fileName
    );

    // Don't download the same output again
    try {
      await fs.access(filePath);

      return `/history/${fileName}`;
    } catch {
      // File doesn't exist, continue
    }

    const buffer = Buffer.from(
      await response.arrayBuffer()
    );

    await fs.writeFile(filePath, buffer);

    console.log(
      "REPLICATE OUTPUT SAVED:",
      filePath
    );

    return `/history/${fileName}`;
  } catch (error) {
    console.error(
      "Failed to save Replicate output:",
      error
    );

    return null;
  }
}

export async function GET(
  request: Request,
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

    const { searchParams } = new URL(request.url);
    const model = searchParams.get("model") || "";

    const token = process.env.REPLICATE_API_TOKEN;

    if (!token) {
      return NextResponse.json(
        {
          error:
            "REPLICATE_API_TOKEN is missing in .env.local",
        },
        { status: 500 }
      );
    }

    const response = await fetch(
      `https://api.replicate.com/v1/predictions/${encodeURIComponent(
        id
      )}`,
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

    // SAVE REPLICATE OUTPUT PERMANENTLY
    let savedOutput = null;

    if (
      prediction?.status === "succeeded" &&
      prediction?.output
    ) {
      savedOutput = await saveReplicateOutput(
        prediction.output,
        id
      );
    }

    return NextResponse.json({
      success: true,
      prediction,
      status: prediction?.status ?? null,

      // Permanent local file URL
      output:
        savedOutput ||
        prediction?.output ||
        null,

      // Original Replicate output
      replicateOutput:
        prediction?.output ?? null,

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