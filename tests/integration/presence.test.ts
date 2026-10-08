import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, closeDb, createUser, loginRoot, type Session } from "./helpers";

type Listed = { id: string; presence?: { online: boolean; lastSeenAt: string | null } };

let root: Session;

beforeAll(async () => {
  root = await loginRoot();
});

afterAll(closeDb);

const listAs = async (session: Session) =>
  (await api("/api/users", { session })).data.users as Listed[];

describe("online presence", () => {
  it("refuses anonymous heartbeats", async () => {
    expect((await api("/api/presence", { method: "POST" })).status).toBe(401);
  });

  it("shows online after a heartbeat, offline right after sign-out", async () => {
    const user = await createUser(root, "user");

    let row = (await listAs(root)).find((item) => item.id === user.id);
    expect(row?.presence).toEqual({ online: false, lastSeenAt: null });

    expect((await api("/api/presence", { method: "POST", session: user.session })).status).toBe(204);

    row = (await listAs(root)).find((item) => item.id === user.id);
    expect(row?.presence?.online).toBe(true);
    expect(row?.presence?.lastSeenAt).toBeTruthy();

    await api("/api/auth/logout", { method: "POST", session: user.session });

    row = (await listAs(root)).find((item) => item.id === user.id);
    expect(row?.presence?.online).toBe(false);
  });

  it("is only shown to the super admin", async () => {
    const admin = await createUser(root, "admin");
    await api("/api/presence", { method: "POST", session: admin.session });

    const asAdmin = await listAs(admin.session);
    expect(asAdmin.length).toBeGreaterThan(0);
    expect(asAdmin.every((item) => item.presence === undefined)).toBe(true);

    expect((await listAs(root)).every((item) => item.presence !== undefined)).toBe(true);
  });
});
