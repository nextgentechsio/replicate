import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export async function GET(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    const token = process.env.REPLICATE_API_TOKEN;

    if (!token) {
      return NextResponse.json(
        { error: "Replicate API token is missing" },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim() || "";

    if (!query) {
      return NextResponse.json({
        models: [],
      });
    }

    const replicateUrl =
      "https://api.replicate.com/v1/search?" +
      new URLSearchParams({
        query,
        limit: "50",
      }).toString();

    const response = await fetch(replicateUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          error: data.detail || "Replicate search failed",
        },
        { status: response.status }
      );
    }

    const models = (data.models || []).map((item: any) => {
      const model = item.model || item;

      return {
        id: `${model.owner}/${model.name}`,
        owner: model.owner,
        name: model.name,
        description: model.description ?? null,
        url: model.url ?? null,
        coverImageUrl: model.cover_image_url ?? null,
        runCount: model.run_count ?? 0,
      };
    });

    return NextResponse.json({
      query,
      models,
    });
  } catch (error) {
    console.error("Replicate search error:", error);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}