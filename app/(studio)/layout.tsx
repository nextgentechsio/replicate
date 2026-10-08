import { redirect } from "next/navigation";
import { getCurrentUser, getSessionStartedAt } from "@/lib/auth";
import { toPublicUser } from "@/lib/users";
import { GenerateProvider } from "./_components/GenerateProvider";
import StudioShell from "./_components/StudioShell";
import { StudioProvider } from "./_components/StudioProvider";

// --------------------------------------------------
// STUDIO LAYOUT (every signed-in page)
//
// proxy.ts already turns away requests without a valid
// cookie; this also catches disabled accounts and
// revoked sessions, and hands the user to the client
// without an extra /api/auth/me round trip. The layout
// persists across navigation, so the shell and the
// Generate state survive moving between pages.
// --------------------------------------------------

export default async function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  const sessionStartedAt = await getSessionStartedAt();

  if (!user || sessionStartedAt === null) redirect("/login");

  return (
    <StudioProvider
      currentUser={toPublicUser(user)}
      sessionStartedAt={sessionStartedAt}
    >
      <GenerateProvider>
        <StudioShell>{children}</StudioShell>
      </GenerateProvider>
    </StudioProvider>
  );
}
