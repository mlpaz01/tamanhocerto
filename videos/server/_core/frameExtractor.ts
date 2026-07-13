// Extração de capturas de tela (frames) do vídeo via ffmpeg.
// Estratégia: detecção de mudança de cena (ótimo p/ gravações de tela/compartilhamento),
// com fallback para frames igualmente espaçados quando o vídeo muda pouco.
import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { ENV } from "./env";

function run(cmd: string, args: string[], timeoutMs = 15 * 60 * 1000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", d => (stdout += d.toString()));
    child.stderr.on("data", d => (stderr += d.toString()));
    child.on("error", err => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: stderr + String(err) }); });
    child.on("close", code => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
  });
}

async function probeDuration(videoPath: string): Promise<number> {
  // ffprobe acompanha o ffmpeg no pacote padrão.
  const probe = ENV.ffmpegPath.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");
  const r = await run(probe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", videoPath], 60_000);
  const d = parseFloat(r.stdout.trim());
  return Number.isFinite(d) ? d : 0;
}

export interface ExtractedFrame {
  buffer: Buffer;
  caption: string;
}

// JPEG (scale 1280, q:v 4): um quadro preto/vazio comprime para ~5KB; uma tela real com
// conteúdo passa de dezenas de KB. Abaixo deste limite tratamos como preto/vazio e descartamos.
const MIN_CONTENT_BYTES = 14 * 1024;

// Verificação extra de luminância via ffmpeg (signalstats YAVG 0..255). Pega quadros escuros
// que por acaso ficaram grandes. Retorna o brilho médio, ou null se não conseguir medir.
async function avgBrightness(jpgPath: string): Promise<number | null> {
  const r = await run(ENV.ffmpegPath, [
    "-i", jpgPath, "-vf", "signalstats,metadata=print:file=-", "-f", "null", "-",
  ], 30_000);
  const m = (r.stdout + r.stderr).match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

export async function extractKeyFrames(videoPath: string, maxFrames = 12): Promise<ExtractedFrame[]> {
  const dir = path.join(os.tmpdir(), `vdoc-frames-${crypto.randomUUID().slice(0, 8)}`);
  await fs.mkdir(dir, { recursive: true });

  const readAll = async (): Promise<string[]> =>
    (await fs.readdir(dir)).filter(f => /\.jpg$/i.test(f)).sort();

  // Mantém só frames com conteúdo real (não pretos/quase vazios).
  const keepWithContent = async (files: string[]): Promise<string[]> => {
    const good: string[] = [];
    for (const f of files) {
      const p = path.join(dir, f);
      const st = await fs.stat(p).catch(() => null);
      if (!st || st.size < MIN_CONTENT_BYTES) continue; // preto/vazio
      const y = await avgBrightness(p);
      if (y !== null && y < 16) continue; // muito escuro (quase preto)
      good.push(f);
    }
    return good;
  };

  try {
    // 1) Detecção de mudança de cena — extrai o DOBRO de candidatos p/ sobrar após filtrar pretos
    await run(ENV.ffmpegPath, [
      "-y", "-i", videoPath,
      "-vf", "select='gt(scene,0.4)',scale=1280:-2",
      "-vsync", "vfr", "-frames:v", String(maxFrames * 2), "-q:v", "4",
      path.join(dir, "scene_%03d.jpg"),
    ]);

    let files = await keepWithContent(await readAll());

    // 2) Fallback: frames igualmente espaçados (evitando início/fim, onde há fade preto)
    if (files.length < 3) {
      for (const f of await readAll()) await fs.rm(path.join(dir, f)).catch(() => {});
      const dur = await probeDuration(videoPath);
      const n = Math.max(6, Math.min(maxFrames * 2, 16));
      if (dur > 0) {
        const start = Math.min(dur * 0.05, 15);   // pula os primeiros 5% (fade)
        const span = dur * 0.9;
        for (let i = 0; i < n; i++) {
          const ts = start + (span * (i + 0.5)) / n;
          await run(ENV.ffmpegPath, [
            "-y", "-ss", ts.toFixed(2), "-i", videoPath,
            "-frames:v", "1", "-vf", "scale=1280:-2", "-q:v", "4",
            path.join(dir, `even_${String(i).padStart(3, "0")}.jpg`),
          ], 120_000);
        }
      }
      files = await keepWithContent(await readAll());
    }

    const out: ExtractedFrame[] = [];
    const chosen = files.slice(0, maxFrames);
    for (let i = 0; i < chosen.length; i++) {
      const buf = await fs.readFile(path.join(dir, chosen[i]));
      out.push({ buffer: buf, caption: `Captura ${i + 1}` });
    }
    return out;
  } catch {
    return [];
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Dimensões de um JPEG (lendo o marcador SOF) — necessário p/ embutir no DOCX sem distorção.
export function jpegSize(buf: Buffer): { width: number; height: number } {
  let off = 2; // pula SOI (FFD8)
  while (off < buf.length) {
    if (buf[off] !== 0xff) { off++; continue; }
    const marker = buf[off + 1];
    // SOF0..SOF15 (exceto DHT/DAC/RST) carregam dimensões
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = buf.readUInt16BE(off + 5);
      const width = buf.readUInt16BE(off + 7);
      return { width, height };
    }
    const len = buf.readUInt16BE(off + 2);
    off += 2 + len;
  }
  return { width: 1280, height: 720 };
}
