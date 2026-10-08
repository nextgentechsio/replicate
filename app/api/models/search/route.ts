import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  readReplicateJson,
  replicateApiUrl,
  replicateErrorMessage,
  upstreamStatus,
} from "@/lib/replicate-api";

type SearchItem = {
  owner?: string;
  name?: string;
  description?: string | null;
  url?: string | null;
  cover_image_url?: string | null;
  run_count?: number;
};

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
    const query = (searchParams.get("q") ?? "").trim().slice(0, 100);

    if (!query) {
      return NextResponse.json({
        models: [],
      });
    }

    const replicateUrl =
      replicateApiUrl("search") +
      "?" +
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

    const data = await readReplicateJson(response);

    if (!response.ok) {
      return NextResponse.json(
        { error: replicateErrorMessage(data, "Replicate search failed") },
        { status: upstreamStatus(response.status) }
      );
    }

    const items = Array.isArray(data.models) ? data.models : [];

    const models = items.map((item: { model?: SearchItem } & SearchItem) => {
      const model: SearchItem = item.model ?? item;

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