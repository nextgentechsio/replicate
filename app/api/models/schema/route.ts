import { NextResponse } from "next/server";
import {
  isValidModelId,
  modelPath,
} from "@/lib/replicate-model";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const model = searchParams.get("model");

    if (!model) {
      return NextResponse.json(
        { error: "Model is required" },
        { status: 400 }
      );
    }

    if (!isValidModelId(model)) {
      return NextResponse.json(
        { error: "Invalid model ID" },
        { status: 400 }
      );
    }

    const token = process.env.REPLICATE_API_TOKEN;

    if (!token) {
      return NextResponse.json(
        { error: "Replicate API token is missing" },
        { status: 500 }
      );
    }

    const response = await fetch(
      `https://api.replicate.com/v1/models/${modelPath(model)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          error: data.detail || "Failed to fetch model schema",
        },
        { status: response.status }
      );
    }

    const openapiSchema =
  data.latest_version?.openapi_schema;

const properties =
  openapiSchema?.components?.schemas?.Input
    ?.properties || {};

const components =
  openapiSchema?.components?.schemas || {};

const inputSchema = Object.fromEntries(
  Object.entries(properties).map(
    ([key, field]: [string, any]) => {
      let resolvedField = field;

      if (field?.allOf?.[0]?.$ref) {
        const refName =
          field.allOf[0].$ref.split("/").pop();

        const referencedSchema =
          components[refName];

        if (referencedSchema) {
          resolvedField = {
            ...referencedSchema,
            ...field,
          };
        }
      }

      return [key, resolvedField];
    }
  )
);
    return NextResponse.json({
      model: `${data.owner}/${data.name}`,
      description: data.description,
      inputSchema,
    });
  } catch (error) {
    console.error("Schema API error:", error);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}