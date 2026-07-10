import {
  int, mysqlEnum, mysqlTable, text, timestamp, varchar, bigint
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  passwordHash: varchar("passwordHash", { length: 255 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const documents = mysqlTable("documents", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 512 }).notNull().default("Processando..."),
  status: mysqlEnum("status", [
    "pending", "uploading", "transcribing", "analyzing", "generating", "done", "error"
  ]).notNull().default("pending"),
  sourceType: mysqlEnum("sourceType", ["upload", "mp4", "youtube"]).notNull(),
  docType: mysqlEnum("docType", ["deloitte", "spec"]).notNull().default("deloitte"),
  youtubeUrl: text("youtubeUrl"),
  videoStorageKey: text("videoStorageKey"),
  fileSizeBytes: bigint("fileSizeBytes", { mode: "number" }),
  transcription: text("transcription"),
  content: text("content"),
  docxStorageKey: text("docxStorageKey"),
  pdfStorageKey: text("pdfStorageKey"),
  // Participantes detectados nos frames iniciais do vídeo (JSON string):
  // { names: string[], possiblyIncomplete: boolean }. Best-effort — pode ser null.
  // EM PRODUÇÃO: aplicar via ALTER TABLE manual, NÃO via db:push (schema divergente).
  participants: text("participants"),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Document = typeof documents.$inferSelect;
export type InsertDocument = typeof documents.$inferInsert;
