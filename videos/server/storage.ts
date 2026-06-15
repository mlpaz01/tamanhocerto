// Storage local em disco — substitui o S3/Forge da plataforma Manus.
// Arquivos ficam em ENV.storageDir/<key> e são servidos via /manus-storage/<key>.

import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { ENV } from "./_core/env";

function baseDir(): string {
  return path.resolve(ENV.storageDir);
}

function normalizeKey(relKey: string): string {
  // Remove barras iniciais e impede path traversal.
  const clean = relKey.replace(/^\/+/, "").replace(/\\/g, "/");
  if (clean.split("/").some(seg => seg === "..")) {
    throw new Error("Invalid storage key");
  }
  return clean;
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

/** Caminho absoluto no disco para uma key (uso interno do servidor). */
export function storagePath(relKey: string): string {
  return path.join(baseDir(), normalizeKey(relKey));
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  _contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const key = appendHashSuffix(normalizeKey(relKey));
  const dest = path.join(baseDir(), key);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const buf = typeof data === "string" ? Buffer.from(data) : Buffer.from(data as Uint8Array);
  await fs.writeFile(dest, buf);
  return { key, url: `/manus-storage/${key}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/manus-storage/${key}` };
}

// Mantém o nome por compatibilidade. No self-hosted devolve uma URL HTTP servível
// (absoluta se PUBLIC_URL estiver definido, senão relativa).
export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const key = normalizeKey(relKey);
  const rel = `/manus-storage/${key}`;
  return ENV.publicUrl ? `${ENV.publicUrl.replace(/\/+$/, "")}${rel}` : rel;
}
