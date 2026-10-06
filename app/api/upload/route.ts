import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
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

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          error: "No file received.",
        },
        { status: 400 }
      );
    }

    const replicateForm = new FormData();

    replicateForm.append(
      "content",
      file,
      file.name
    );

    const response = await fetch(
      "https://api.replicate.com/v1/files",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: replicateForm,
      }
    );

    const text = await response.text();

    let data: any = {};

    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {
        raw: text,
      };
    }

    console.log(
      "REPLICATE FILE STATUS:",
      response.status
    );

    console.log(
      "REPLICATE FILE RESPONSE:",
      data
    );

    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            data?.detail ||
            data?.error ||
            data?.raw ||
            `Replicate upload failed (${response.status})`,
        },
        { status: response.status }
      );
    }

    const url = data?.urls?.get;

    if (!url) {
      return NextResponse.json(
        {
          error:
            "Replicate upload succeeded but no file URL was returned.",
          response: data,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      url,
    });
  } catch (error) {
    console.error(
      "UPLOAD ROUTE ERROR:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Upload failed.",
      },
      { status: 500 }
    );
  }
}