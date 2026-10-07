import { MongoClient, type Collection, type Db } from "mongodb";
import type { Role } from "@/lib/roles";

// --------------------------------------------------
// MONGODB CONNECTION
//
// One client per server process. Cached on globalThis
// so dev hot-reloads don't open a new pool each time.
// Indexes are created once per process on first use.
// --------------------------------------------------

export type UserDoc = {
  _id: string;
  username: string;
  name: string;
  role: Role;
  disabled: boolean;
  passwordHash: string;
  sessionVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ProjectStatus = "active" | "archived";

export type ProjectDoc = {
  _id: string;
  name: string;
  // Lowercased name for case-insensitive uniqueness
  nameKey: string;
  description: string;
  status: ProjectStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

const globalForMongo = globalThis as unknown as {
  mongoClientPromise?: Promise<MongoClient>;
  mongoSetupPromise?: Promise<void>;
};

function getClient(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI is missing in .env.local");
  }

  if (!globalForMongo.mongoClientPromise) {
    globalForMongo.mongoClientPromise = new MongoClient(uri)
      .connect()
      .catch((error) => {
        // Allow a retry on the next request
        globalForMongo.mongoClientPromise = undefined;
        throw error;
      });
  }

  return globalForMongo.mongoClientPromise;
}

async function setupIndexes(db: Db) {
  await Promise.all([
    db
      .collection<UserDoc>("users")
      .createIndex({ username: 1 }, { unique: true }),
    db
      .collection<ProjectDoc>("projects")
      .createIndex({ nameKey: 1 }, { unique: true }),
  ]);
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  const db = client.db(process.env.MONGODB_DB || "ai_studio");

  if (!globalForMongo.mongoSetupPromise) {
    globalForMongo.mongoSetupPromise = setupIndexes(db).catch(
      (error) => {
        globalForMongo.mongoSetupPromise = undefined;
        throw error;
      }
    );
  }

  await globalForMongo.mongoSetupPromise;

  return db;
}

export async function usersCollection(): Promise<
  Collection<UserDoc>
> {
  return (await getDb()).collection<UserDoc>("users");
}

export async function projectsCollection(): Promise<
  Collection<ProjectDoc>
> {
  return (await getDb()).collection<ProjectDoc>("projects");
}

export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}
