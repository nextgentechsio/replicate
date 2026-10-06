import { NextResponse } from "next/server";
import { calculateReplicateCost } from "@/lib/replicate-cost";

export const runtime = "nodejs";

function isValidReplicateUri(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const valueTrimmed = value.trim();

  return (
    valueTrimmed.startsWith("https://") ||
    valueTrimmed.startsWith("http://")
  );
}

function normalizeInputs(
  rawInputs: Record<string, unknown>
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {
    ...rawInputs,
  };

  // START IMAGE
  if (inputs.start_image !== undefined) {
    if (Array.isArray(inputs.start_image)) {
      const value = inputs.start_image.find(
        isValidReplicateUri
      );

      if (value) {
        inputs.start_image = value;
      } else {
        delete inputs.start_image;
      }
    } else if (
      !isValidReplicateUri(inputs.start_image)
    ) {
      delete inputs.start_image;
    }
  }

  // END IMAGE
  if (inputs.end_image !== undefined) {
    if (Array.isArray(inputs.end_image)) {
      const value = inputs.end_image.find(
        isValidReplicateUri
      );

      if (value) {
        inputs.end_image = value;
      } else {
        delete inputs.end_image;
      }
    } else if (
      !isValidReplicateUri(inputs.end_image)
    ) {
      delete inputs.end_image;
    }
  }

  // REFERENCE IMAGES
  if (inputs.reference_images !== undefined) {
    let values: unknown[] = [];

    if (Array.isArray(inputs.reference_images)) {
      values = inputs.reference_images;
    } else if (
      typeof inputs.reference_images === "string"
    ) {
      values = [inputs.reference_images];
    }

    values = values.filter(isValidReplicateUri);

    if (values.length > 0) {
      inputs.reference_images = values;
    } else {
      delete inputs.reference_images;
    }
  }

  // REFERENCE VIDEO
  if (inputs.reference_video !== undefined) {
    if (Array.isArray(inputs.reference_video)) {
      const value = inputs.reference_video.find(
        isValidReplicateUri
      );

      if (value) {
        inputs.reference_video = value;
      } else {
        delete inputs.reference_video;
      }
    } else if (
      !isValidReplicateUri(
        inputs.reference_video
      )
    ) {
      delete inputs.reference_video;
    }
  }
  // --------------------------------------------------
  // MULTI PROMPT
  // Kling expects valid JSON
  // --------------------------------------------------

  if (inputs.multi_prompt !== undefined) {
    if (typeof inputs.multi_prompt === "string") {
      const value = inputs.multi_prompt.trim();

      if (value) {
        try {
          JSON.parse(value);

          inputs.multi_prompt = value;
        } catch {
          inputs.multi_prompt = JSON.stringify([
            {
              prompt: value,
              duration: Number(inputs.duration) || 5,
            },
          ]);
        }
      } else {
        delete inputs.multi_prompt;
      }
    }
  }

  return inputs;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      user,
      project,
      model,
      inputs,
    } = body;

    // --------------------------------------------------
    // VALIDATION
    // --------------------------------------------------

    if (!user) {
      return NextResponse.json(
        {
          error: "User is required",
        },
        { status: 400 }
      );
    }

    if (!project) {
      return NextResponse.json(
        {
          error: "Project is required",
        },
        { status: 400 }
      );
    }

    if (!model) {
      return NextResponse.json(
        {
          error: "Model is required",
        },
        { status: 400 }
      );
    }

    if (
      !inputs ||
      typeof inputs !== "object" ||
      Array.isArray(inputs)
    ) {
      return NextResponse.json(
        {
          error:
            "Model inputs are required",
        },
        { status: 400 }
      );
    }

    const token =
      process.env.REPLICATE_API_TOKEN;

    if (!token) {
      return NextResponse.json(
        {
          error:
            "REPLICATE_API_TOKEN is missing in .env.local",
        },
        { status: 500 }
      );
    }

    // --------------------------------------------------
    // NORMALIZE INPUTS
    // --------------------------------------------------

    const normalizedInputs =
      normalizeInputs(
        inputs as Record<
          string,
          unknown
        >
      );

    console.log(
      "ORIGINAL INPUTS:",
      inputs
    );

    console.log(
      "NORMALIZED REPLICATE INPUTS:",
      normalizedInputs
    );

    // --------------------------------------------------
    // GET MODEL
    // --------------------------------------------------

    const modelResponse = await fetch(
      `https://api.replicate.com/v1/models/${model}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      }
    );

    const modelData =
      await modelResponse.json();

    if (!modelResponse.ok) {
      return NextResponse.json(
        {
          error:
            modelData?.detail ||
            "Failed to fetch selected model",
          details: modelData,
        },
        {
          status:
            modelResponse.status,
        }
      );
    }

    const versionId =
      modelData?.latest_version?.id;

    if (!versionId) {
      return NextResponse.json(
        {
          error:
            "Selected model does not have a runnable latest version.",
        },
        { status: 400 }
      );
    }

    // --------------------------------------------------
    // CREATE REPLICATE PREDICTION
    // --------------------------------------------------

    console.log(
      "CREATING REPLICATE PREDICTION:",
      {
        model,
        versionId,
        input: normalizedInputs,
      }
    );

   const predictionResponse = await fetch(
  `https://api.replicate.com/v1/models/${model}/predictions`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
  input: normalizedInputs,
}),
  }
);

    const predictionData =
      await predictionResponse.json();

    console.log(
      "REPLICATE PREDICTION RESPONSE:",
      predictionData
    );

    // --------------------------------------------------
    // REPLICATE ERROR
    // --------------------------------------------------

    if (!predictionResponse.ok) {
      return NextResponse.json(
        {
          error:
            predictionData?.detail ||
            predictionData?.error ||
            "Replicate prediction failed",

          details:
            predictionData,
        },
        {
          status:
            predictionResponse.status,
        }
      );
    }

    // --------------------------------------------------
    // COST
    // --------------------------------------------------

    const costUsd =
      calculateReplicateCost(
        model,
        predictionData
      );

    console.log(
      "REPLICATE COST:",
      {
        model,

        resolution:
          normalizedInputs?.resolution,

        status:
          predictionData?.status,

        costUsd,
      }
    );

    // --------------------------------------------------
    // TRACKING
    // --------------------------------------------------

    const tracking = {
      user,
      project,

      provider:
        "Replicate",

      model,

      version:
        versionId,

      predictionId:
        predictionData?.id,

      status:
        predictionData?.status,

      createdAt:
        predictionData?.created_at,
    };

    console.log(
      "FINOPS GENERATION:",
      tracking
    );

    // --------------------------------------------------
    // RESPONSE
    // --------------------------------------------------

    return NextResponse.json({
      success: true,

      tracking,

      prediction:
        predictionData,

      costUsd,
    });
  } catch (error) {
    console.error(
      "Generate API error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Internal server error",
      },
      {
        status: 500,
      }
    );
  }
}