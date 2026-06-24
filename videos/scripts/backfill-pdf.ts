// Gera o PDF (a partir do DOCX já salvo) para documentos concluídos que ainda não têm PDF.
// Uso: pnpm exec tsx scripts/backfill-pdf.ts
import "dotenv/config";
import { promises as fs } from "fs";
import { eq } from "drizzle-orm";
import { getDb, updateDocument } from "../server/db";
import { documents } from "../drizzle/schema";
import { docxBufferToPdf } from "../server/pdfGenerator";
import { storagePath, storagePut } from "../server/storage";

async function main() {
  const db = await getDb();
  if (!db) { console.error("Banco indisponível"); process.exit(1); }
  const rows = await db.select().from(documents).where(eq(documents.status, "done"));
  let ok = 0, skip = 0, fail = 0;
  for (const d of rows) {
    if (!d.docxStorageKey || d.pdfStorageKey) { skip++; continue; }
    try {
      const buf = await fs.readFile(storagePath(d.docxStorageKey));
      const pdf = await docxBufferToPdf(buf);
      const { key } = await storagePut(`documents/${d.userId}/${d.id}/document.pdf`, pdf, "application/pdf");
      await updateDocument(d.id, { pdfStorageKey: key });
      console.log(`doc ${d.id} (${d.title}): PDF gerado`);
      ok++;
    } catch (e: any) {
      console.error(`doc ${d.id}: FALHOU - ${e?.message}`);
      fail++;
    }
  }
  console.log(`\nResumo: ${ok} gerados, ${skip} pulados, ${fail} falharam`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
