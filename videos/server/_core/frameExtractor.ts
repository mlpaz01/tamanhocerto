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

export async function extractKeyFrames(videoPath: string, maxFrames = 12): Promise<ExtractedFrame[]> {
  const dir = path.join(os.tmpdir(), `vdoc-frames-${crypto.randomUUID().slice(0, 8)}`);
  await fs.mkdir(dir, { recursive: true });

  const readAll = async (): Promise<string[]> =>
    (await fs.readdir(dir)).filter(f => /\.jpg$/i.test(f)).sort();

  try {
    // 1) Detecção de mudança de cena
    await run(ENV.ffmpegPath, [
      "-y", "-i", videoPath,
      "-vf", "select='gt(scene,0.4)',scale=1280:-2",
      "-vsync", "vfr", "-frames:v", String(maxFrames), "-q:v", "4",
      path.join(dir, "scene_%03d.jpg"),
    ]);

    let files = await readAll();

    // 2) Fallback: frames igualmente espaçados ao longo da duração
    if (files.length < 3) {
      for (const f of files) await fs.rm(path.join(dir, f)).catch(() => {});
      const dur = await probeDuration(videoPath);
      const n = Math.max(4, Math.min(maxFrames, 8));
      if (dur > 0) {
        for (let i = 0; i < n; i++) {
          const ts = (dur * (i + 0.5)) / n;
          await run(ENV.ffmpegPath, [
            "-y", "-ss", ts.toFixed(2), "-i", videoPath,
            "-frames:v", "1", "-vf", "scale=1280:-2", "-q:v", "4",
            path.join(dir, `even_${String(i).padStart(3, "0")}.jpg`),
          ], 120_000);
        }
      }
      files = await readAll();
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
