import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createUser, listUsers } from "@/lib/users";

export const runtime = "nodejs";

const MANAGERS = ["super_admin", "admin"] as const;

export async function GET() {
  const auth = await requireUser([...MANAGERS]);
  if (auth.response) return auth.response;

  return NextResponse.json({
    users: await listUsers(),
  });
}

export async function POST(request: Request) {
  const auth = await requireUser([...MANAGERS]);
  if (auth.response) return auth.response;

  try {
    const body = await request.json().catch(() => ({}));

    const result = await createUser(auth.user, body ?? {});

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json(
      { user: result.user },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create user error:", error);

    return NextResponse.json(
      { error: "Failed to create user" },
      { status: 500 }
    );
  }
}
