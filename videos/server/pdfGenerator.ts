// Converte um DOCX em PDF usando o LibreOffice headless (soffice --convert-to pdf).
// Mantém a mesma formatação do DOCX (capa, tabelas, imagens/capturas).
import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { ENV } from "./_core/env";

function run(cmd: string, args: string[], timeoutMs = 5 * 60 * 1000): Promise<{ code: number; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stderr.on("data", d => (stderr += d.toString()));
    child.on("error", err => { clearTimeout(timer); resolve({ code: -1, stderr: stderr + String(err) }); });
    child.on("close", code => { clearTimeout(timer); resolve({ code: code ?? -1, stderr }); });
  });
}

export async function docxBufferToPdf(docxBuffer: Buffer): Promise<Buffer> {
  const dir = path.join(os.tmpdir(), `vdoc-pdf-${crypto.randomUUID().slice(0, 8)}`);
  const profile = path.join(dir, "loprofile");
  const docxPath = path.join(dir, "document.docx");
  const pdfPath = path.join(dir, "document.pdf");
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.writeFile(docxPath, docxBuffer);
    const r = await run(ENV.libreofficePath, [
      `-env:UserInstallation=file://${profile}`,
      "--headless", "--norestore", "--nolockcheck",
      "--convert-to", "pdf", "--outdir", dir, docxPath,
    ]);
    const pdf = await fs.readFile(pdfPath).catch(() => null);
    if (!pdf) {
      throw new Error(`LibreOffice não gerou PDF (code ${r.code}): ${r.stderr.slice(-500)}`);
    }
    return pdf;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
