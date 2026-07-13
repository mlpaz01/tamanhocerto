// Testa a extração de frames (sem usar Groq/OpenRouter): extrai do maior vídeo e reporta
// tamanhos. Frames pretos são descartados; os salvos devem todos ter conteúdo (>14KB).
// Uso: pnpm exec tsx scripts/test-frames.ts [chave-opcional]
import "dotenv/config";
import { promises as fs } from "fs";
import path from "path";
import { ENV } from "../server/_core/env";
import { extractKeyFrames } from "../server/_core/frameExtractor";
import { storagePath } from "../server/storage";

async function findLargest(): Promise<string> {
  const base = path.join(path.resolve(ENV.storageDir), "videos");
  let best = "", bestSize = 0;
  for (const u of await fs.readdir(base).catch(() => [] as string[])) {
    const dir = path.join(base, u);
    if (!(await fs.stat(dir).catch(() => null))?.isDirectory()) continue;
    for (const f of await fs.readdir(dir).catch(() => [] as string[])) {
      if (!/\.mp4$/i.test(f)) continue;
      const s = await fs.stat(path.join(dir, f));
      if (s.size > bestSize) { bestSize = s.size; best = `videos/${u}/${f}`; }
    }
  }
  if (!best) throw new Error("Nenhum .mp4 em data/storage/videos");
  return best;
}

async function main() {
  const KEY = process.argv[2] || (await findLargest());
  console.log("Vídeo:", KEY);
  const frames = await extractKeyFrames(storagePath(KEY), 12);
  console.log(`Frames com conteúdo: ${frames.length}`);
  const outdir = path.resolve("test-frames-out");
  await fs.rm(outdir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(outdir, { recursive: true });
  for (let i = 0; i < frames.length; i++) {
    await fs.writeFile(path.join(outdir, `frame_${i + 1}.jpg`), frames[i].buffer);
    console.log(`  frame ${i + 1}: ${(frames[i].buffer.length / 1024).toFixed(1)} KB`);
  }
  console.log(`\nSalvos em ${outdir}/ — abra pra conferir que nenhum está preto.`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
