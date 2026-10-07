import { NextResponse } from "next/server";

export const runtime = "nodejs";

// --------------------------------------------------
// ALLOWED SOURCES
//
// This route fetches server-side, so an open URL would
// let callers reach internal hosts (SSRF). Only
// Replicate's output CDN is allowed, and every redirect
// hop is re-checked.
// --------------------------------------------------

const MAX_REDIRECTS = 3;

function isAllowedOutputUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    (url.hostname === "replicate.delivery" ||
      url.hostname.endsWith(".replicate.delivery"))
  );
}

function isReplicatePredictionUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    url.hostname === "api.replicate.com" &&
    url.pathname.startsWith("/v1/predictions/")
  );
}

async function fetchAllowedOutput(
  url: string
): Promise<Response> {
  let current = new URL(url);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedOutputUrl(current)) {
      throw new Error("Download source is not allowed");
    }

    const response = await fetch(current, {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
    });

    const location = response.headers.get("location");

    if (
      response.status >= 300 &&
      response.status < 400 &&
      location
    ) {
      current = new URL(location, current);
      continue;
    }

    return response;
  }

  throw new Error("Too many redirects");
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedUrl = searchParams.get("url");

    if (!requestedUrl) {
      return NextResponse.json(
        { error: "URL is required" },
        { status: 400 }
      );
    }

    let parsedUrl: URL;

    try {
      parsedUrl = new URL(requestedUrl);
    } catch {
      return NextResponse.json(
        { error: "Invalid URL" },
        { status: 400 }
      );
    }

    if (
      !isAllowedOutputUrl(parsedUrl) &&
      !isReplicatePredictionUrl(parsedUrl)
    ) {
      return NextResponse.json(
        { error: "Download source is not allowed" },
        { status: 400 }
      );
    }

    let fileUrl = requestedUrl;

    // --------------------------------------------------
    // REPLICATE PREDICTION URL
    // --------------------------------------------------

    if (isReplicatePredictionUrl(parsedUrl)) {
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

      const predictionResponse = await fetch(
        parsedUrl,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
          // Never carry the token to another host
          redirect: "error",
        }
      );

      const predictionText =
        await predictionResponse.text();

      let predictionData: any = {};

      try {
        predictionData = predictionText
          ? JSON.parse(predictionText)
          : {};
      } catch {
        predictionData = {};
      }

      console.log(
        "REPLICATE PREDICTION STATUS:",
        predictionResponse.status
      );

      console.log(
        "REPLICATE PREDICTION:",
        predictionData
      );

      if (!predictionResponse.ok) {
        return NextResponse.json(
          {
            error:
              predictionData?.detail ||
              predictionData?.error ||
              `Replicate prediction request failed (${predictionResponse.status})`,
          },
          { status: predictionResponse.status }
        );
      }

      // Prediction is still running
      if (
        predictionData.status === "starting" ||
        predictionData.status === "processing"
      ) {
        return NextResponse.json(
          {
            error: "Generation is still processing.",
            status: predictionData.status,
          },
          { status: 202 }
        );
      }

      if (predictionData.status === "failed") {
        return NextResponse.json(
          {
            error:
              predictionData.error ||
              "Replicate generation failed.",
          },
          { status: 500 }
        );
      }

      if (predictionData.status === "canceled") {
        return NextResponse.json(
          {
            error: "Replicate generation was canceled.",
          },
          { status: 500 }
        );
      }

      // --------------------------------------------------
      // GET ACTUAL OUTPUT URL
      // --------------------------------------------------

      const output = predictionData.output;

      if (Array.isArray(output)) {
        fileUrl = output[0];
      } else if (typeof output === "string") {
        fileUrl = output;
      }

      if (!fileUrl) {
        return NextResponse.json(
          {
            error:
              "Prediction succeeded but no output file URL was returned.",
            prediction: predictionData,
          },
          { status: 500 }
        );
      }
    }

    // --------------------------------------------------
    // DOWNLOAD ACTUAL FILE
    // --------------------------------------------------

    console.log("DOWNLOADING FILE:", fileUrl);

    let response: Response;

    try {
      response = await fetchAllowedOutput(fileUrl);
    } catch (fetchError) {
      return NextResponse.json(
        {
          error:
            fetchError instanceof Error
              ? fetchError.message
              : "Download source is not allowed",
        },
        { status: 400 }
      );
    }

    if (!response.ok) {
      console.error(
        "Download source error:",
        response.status,
        response.statusText
      );

      return NextResponse.json(
        {
          error: `Failed to download file (${response.status})`,
        },
        { status: response.status }
      );
    }

    const contentType =
      response.headers.get("content-type") ||
      "application/octet-stream";

    const buffer = await response.arrayBuffer();

    // --------------------------------------------------
    // DETERMINE FILE EXTENSION
    // --------------------------------------------------

    const outputUrl = new URL(fileUrl);

    const urlPath =
      outputUrl.pathname.toLowerCase();

    let extension = "bin";

    if (
      contentType.includes("video/mp4") ||
      urlPath.endsWith(".mp4")
    ) {
      extension = "mp4";
    } else if (
      contentType.includes("video/webm") ||
      urlPath.endsWith(".webm")
    ) {
      extension = "webm";
    } else if (
      contentType.includes("image/png") ||
      urlPath.endsWith(".png")
    ) {
      extension = "png";
    } else if (
      contentType.includes("image/jpeg") ||
      contentType.includes("image/jpg") ||
      urlPath.endsWith(".jpg") ||
      urlPath.endsWith(".jpeg")
    ) {
      extension = "jpg";
    } else if (
      contentType.includes("image/webp") ||
      urlPath.endsWith(".webp")
    ) {
      extension = "webp";
    }

    // --------------------------------------------------
    // FORCE CORRECT MIME TYPE
    // --------------------------------------------------

    let finalContentType = contentType;

    if (extension === "mp4") {
      finalContentType = "video/mp4";
    } else if (extension === "webm") {
      finalContentType = "video/webm";
    } else if (extension === "png") {
      finalContentType = "image/png";
    } else if (extension === "jpg") {
      finalContentType = "image/jpeg";
    } else if (extension === "webp") {
      finalContentType = "image/webp";
    }

    console.log(
      "FINAL DOWNLOAD:",
      extension,
      finalContentType,
      buffer.byteLength
    );

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": finalContentType,
        "Content-Disposition": `attachment; filename="generated-output.${extension}"`,
        "Content-Length":
          buffer.byteLength.toString(),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(
      "Download proxy error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Download failed",
      },
      { status: 500 }
    );
  }
}