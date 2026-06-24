// Regenera DOCX (corrigido p/ Office Online) + PDF para documentos concluídos,
// a partir do conteúdo markdown já salvo — sem usar Groq/OpenRouter.
// Uso: pnpm exec tsx scripts/backfill-pdf.ts
import { eq } from "drizzle-orm";
import { getDb, updateDocument } from "../server/db";
import { documents } from "../drizzle/schema";
import { generateSpecDocx } from "../server/docxGenerator";
import { docxBufferToPdf } from "../server/pdfGenerator";
import { storagePut } from "../server/storage";
import "dotenv/config";

async function main() {
  const db = await getDb();
  if (!db) { console.error("Banco indisponível"); process.exit(1); }
  const rows = await db.select().from(documents).where(eq(documents.status, "done"));
  let ok = 0, skip = 0, fail = 0;
  for (const d of rows) {
    // Regenera DOCX (corrigido) + PDF de todos os concluídos que têm conteúdo
    if (!d.content) { skip++; continue; }
    try {
      const docxBuf = await generateSpecDocx({ title: d.title, markdown: d.content });
      const { key: docxKey } = await storagePut(`documents/${d.userId}/${d.id}/document.docx`, docxBuf, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      const pdf = await docxBufferToPdf(docxBuf);
      const { key: pdfKey } = await storagePut(`documents/${d.userId}/${d.id}/document.pdf`, pdf, "application/pdf");
      await updateDocument(d.id, { docxStorageKey: docxKey, pdfStorageKey: pdfKey });
      console.log(`doc ${d.id} (${d.title}): DOCX+PDF regenerados`);
      ok++;
    } catch (e: any) {
      console.error(`doc ${d.id}: FALHOU - ${e?.message}`);
      fail++;
    }
  }
  console.log(`\nResumo: ${ok} regenerados, ${skip} pulados, ${fail} falharam`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
