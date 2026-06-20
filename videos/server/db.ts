import { eq, desc, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, documents, InsertDocument, Document } from "../drizzle/schema";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createUser(data: InsertUser): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(users).values(data);
}

// Documents
export async function createDocument(data: InsertDocument): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(documents).values(data);
  return (result[0] as any).insertId as number;
}

export async function getDocumentById(id: number): Promise<Document | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  return result[0];
}

export async function getDocumentsByUserId(userId: number): Promise<Document[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(documents).where(eq(documents.userId, userId)).orderBy(desc(documents.createdAt));
}

export async function updateDocument(id: number, data: Partial<InsertDocument>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(documents).set(data).where(eq(documents.id, id));
}

// Na inicialização: documentos presos em etapas de processamento significam que o
// servidor reiniciou no meio do trabalho. Marca como erro para não ficarem "girando".
export async function failStuckDocuments(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.update(documents)
      .set({ status: "error", errorMessage: "Processamento interrompido (servidor reiniciado). Gere novamente." })
      .where(inArray(documents.status, ["pending", "uploading", "transcribing", "analyzing", "generating"]));
  } catch (e) {
    console.warn("[Database] failStuckDocuments:", e);
  }
}
