// Download do VÍDEO do YouTube (não só o áudio) para permitir extração de capturas de tela.
// Baixa até 720p (suficiente p/ telas legíveis) e grava exatamente em finalPath (mp4).
import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { ENV } from "./env";

function run(cmd: string, args: string[], timeoutMs = 20 * 60 * 1000): Promise<{ code: number; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stderr.on("data", d => (stderr += d.toString()));
    child.on("error", err => { clearTimeout(timer); resolve({ code: -1, stderr: stderr + String(err) }); });
    child.on("close", code => { clearTimeout(timer); resolve({ code: code ?? -1, stderr }); });
  });
}

export async function downloadYoutubeVideo(url: string, finalPath: string): Promise<void> {
  const dir = path.dirname(finalPath);
  await fs.mkdir(dir, { recursive: true });
  const tag = `._ytdl_${crypto.randomUUID().slice(0, 8)}`;
  const outTmpl = path.join(dir, `${tag}.%(ext)s`);

  const args = [
    "-f", "bv*[height<=720]+ba/b[height<=720]/b",
    "--merge-output-format", "mp4",
    "--no-playlist", "--no-warnings",
    "-o", outTmpl,
  ];
  if (/[\\/]/.test(ENV.ffmpegPath)) args.push("--ffmpeg-location", ENV.ffmpegPath);
  if (ENV.ytdlpCookies) args.push("--cookies", ENV.ytdlpCookies);
  args.push(url);

  const r = await run(ENV.ytDlpPath, args);
  const produced = (await fs.readdir(dir)).find(f => f.startsWith(tag));
  if (r.code !== 0 || !produced) {
    // limpa restos
    for (const f of (await fs.readdir(dir)).filter(f => f.startsWith(tag))) {
      await fs.rm(path.join(dir, f), { force: true }).catch(() => {});
    }
    throw new Error(`Falha ao baixar vídeo do YouTube: ${r.stderr.slice(-800)}`);
  }
  await fs.rm(finalPath, { force: true }).catch(() => {});
  await fs.rename(path.join(dir, produced), finalPath);
}
