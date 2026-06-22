// Teste batch: transcreve UMA vez o maior vídeo já presente em data/storage/videos
// e gera os DOIS tipos de documento (deloitte + spec), com capturas de tela.
// Uso (a partir da pasta do app):  pnpm exec tsx scripts/gen-both.ts [chave-opcional]
import "dotenv/config";
import { promises as fs } from "fs";
import path from "path";
import { ENV } from "../server/_core/env";
import { createDocument, updateDocument, getUserByEmail } from "../server/db";
import { transcribeAudio } from "../server/_core/voiceTranscription";
import { extractKeyFrames } from "../server/_core/frameExtractor";
import { generateDeloitteDocument, formatDocumentAsMarkdown, generateSpecDocument } from "../server/documentGenerator";
import { generateDocx, generateSpecDocx } from "../server/docxGenerator";
import { storagePath, storagePut, storageGetSignedUrl } from "../server/storage";

async function findLargestVideo(): Promise<string> {
  const base = path.join(path.resolve(ENV.storageDir), "videos");
  let best = "";
  let bestSize = 0;
  const users = await fs.readdir(base).catch(() => [] as string[]);
  for (const u of users) {
    const dir = path.join(base, u);
    const st = await fs.stat(dir).catch(() => null);
    if (!st?.isDirectory()) continue;
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    for (const f of files) {
      if (!/\.mp4$/i.test(f)) continue;
      const s = await fs.stat(path.join(dir, f));
      if (s.size > bestSize) { bestSize = s.size; best = `videos/${u}/${f}`; }
    }
  }
  if (!best) throw new Error("Nenhum .mp4 encontrado em data/storage/videos");
  console.log(`Maior video encontrado: ${best} (${(bestSize / 1024 / 1024).toFixed(0)} MB)`);
  return best;
}

async function main() {
  const KEY = process.argv[2] || (await findLargestVideo());
  const user = await getUserByEmail("marciolpaz@gmail.com");
  const userId = user?.id ?? 1;

  console.log("Transcrevendo UMA vez (reutiliza p/ os 2 tipos)...");
  const t = await transcribeAudio({ audioUrl: storagePath(KEY), language: "pt", prompt: "Reuniao tecnica." });
  if ("error" in t) {
    console.error("TRANSCRICAO FALHOU:", (t as any).error, (t as any).details || "");
    process.exit(1);
  }
  console.log("Transcricao OK:", t.text.length, "chars");

  console.log("Extraindo capturas UMA vez...");
  const frames = await extractKeyFrames(storagePath(KEY), 12);
  console.log("Capturas:", frames.length);

  const results: any[] = [];
  for (const docType of ["deloitte", "spec"] as const) {
    try {
      const id = await createDocument({ userId, title: "Teste " + docType, sourceType: "upload", docType, videoStorageKey: KEY, status: "generating" });
      let shotMd = "";
      for (let i = 0; i < frames.length; i++) {
        const { key } = await storagePut(`documents/${userId}/${id}/shot_${i + 1}.jpg`, frames[i].buffer, "image/jpeg");
        const url = await storageGetSignedUrl(key);
        shotMd += `\n![${frames[i].caption}](${url})\n\n*${frames[i].caption}*\n`;
      }
      let title: string, md: string, buf: Buffer;
      if (docType === "spec") {
        const s = await generateSpecDocument(t.text);
        title = s.title; md = s.markdown; buf = await generateSpecDocx(s, frames);
      } else {
        const d = await generateDeloitteDocument(t.text);
        title = d.title; md = formatDocumentAsMarkdown(d); buf = await generateDocx(d, frames);
      }
      if (shotMd) md += `\n\n---\n\n## Capturas de Tela de Referencia\n${shotMd}`;
      const { key } = await storagePut(`documents/${userId}/${id}/document.docx`, buf, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      await updateDocument(id, { title, content: md, docxStorageKey: key, status: "done" });
      console.log(`[${docType}] OK -> doc id=${id} | titulo='${title}'`);
      results.push({ docType, id, title });
    } catch (e: any) {
      console.error(`[${docType}] FALHOU:`, e?.message);
      results.push({ docType, erro: e?.message });
    }
  }

  console.log("\n===== RESUMO =====");
  results.forEach(r => console.log(JSON.stringify(r)));
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
