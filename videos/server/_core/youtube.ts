// Integração com YouTube SEM baixar o vídeo inteiro:
//  - fetchYoutubeTranscript: puxa a legenda automática (texto) — transcrição instantânea, sem Groq.
//  - grabYoutubeFrames: pega a URL do stream e captura poucos quadros via "seek" do ffmpeg
//    (baixa só os bytes ao redor de cada instante), sem baixar o vídeo todo.
//  - downloadYoutubeVideo: fallback, baixa o vídeo (<=720p) quando necessário.
// Todas as chamadas passam cookies (ENV.ytdlpCookies) para driblar o "confirm you're not a bot".
import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { ENV } from "./env";
import type { ExtractedFrame } from "./frameExtractor";

function run(cmd: string, args: string[], timeoutMs = 20 * 60 * 1000): Promise<{ code: number; stdout: string; stderr: string }> {
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

// Args comuns a todas as chamadas yt-dlp (cookies + no-playlist).
function ytCommon(): string[] {
  const a = ["--no-playlist", "--no-warnings"];
  if (ENV.ytdlpCookies) a.push("--cookies", ENV.ytdlpCookies);
  return a;
}

// ---- Transcrição via legenda automática (sem baixar mídia) ----
function parseSubs(raw: string): string {
  const out: string[] = [];
  for (let line of raw.split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;
    if (/^\d+$/.test(line)) continue;                 // número da legenda (srt)
    if (/-->/.test(line)) continue;                   // linha de tempo
    if (/^(WEBVTT|Kind:|Language:)/i.test(line)) continue;
    const clean = line.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim(); // remove tags inline
    if (!clean) continue;
    if (out[out.length - 1] === clean) continue;      // dedup consecutivo (legenda rolante repete)
    out.push(clean);
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

export async function fetchYoutubeTranscript(url: string): Promise<string | null> {
  const dir = path.join(os.tmpdir(), `vdoc-subs-${crypto.randomUUID().slice(0, 8)}`);
  await fs.mkdir(dir, { recursive: true });
  try {
    const r = await run(ENV.ytDlpPath, [
      ...ytCommon(),
      "--skip-download",
      "--write-auto-subs", "--write-subs",
      "--sub-langs", "pt.*,pt-BR,pt,en.*,en",
      "--convert-subs", "srt",
      "-o", path.join(dir, "sub.%(ext)s"),
      url,
    ], 5 * 60 * 1000);
    const files = (await fs.readdir(dir)).filter(f => /\.srt$/i.test(f));
    // preferência: pt antes de en
    files.sort((a, b) => (a.includes("pt") ? -1 : 1) - (b.includes("pt") ? -1 : 1));
    if (!files.length) return null;
    const raw = await fs.readFile(path.join(dir, files[0]), "utf8");
    const text = parseSubs(raw);
    return text.length > 40 ? text : null;
  } catch {
    return null;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---- Capturas via seek no stream (sem baixar o vídeo todo) ----
async function videoStreamUrl(url: string): Promise<string | null> {
  const r = await run(ENV.ytDlpPath, [...ytCommon(), "-g", "-f", "bv*[height<=720]/b[height<=720]/b", url], 3 * 60 * 1000);
  const first = r.stdout.split("\n").map(s => s.trim()).find(s => /^https?:\/\//.test(s));
  return first ?? null;
}

async function youtubeDuration(url: string): Promise<number> {
  const r = await run(ENV.ytDlpPath, [...ytCommon(), "--skip-download", "--print", "duration", url], 2 * 60 * 1000);
  const d = parseFloat(r.stdout.trim());
  return Number.isFinite(d) ? d : 0;
}

const MIN_CONTENT_BYTES = 14 * 1024;

export async function grabYoutubeFrames(url: string, count = 12): Promise<ExtractedFrame[]> {
  const streamUrl = await videoStreamUrl(url);
  const dur = await youtubeDuration(url);
  if (!streamUrl || dur <= 0) return [];

  const dir = path.join(os.tmpdir(), `vdoc-ytf-${crypto.randomUUID().slice(0, 8)}`);
  await fs.mkdir(dir, { recursive: true });
  try {
    const n = Math.min(count * 2, 28);      // captura o dobro; descarta pretas depois
    const start = Math.min(dur * 0.04, 20); // pula o comecinho (fade/intro)
    const span = dur * 0.92;
    const out: ExtractedFrame[] = [];
    for (let i = 0; i < n && out.length < count; i++) {
      const ts = start + (span * (i + 0.5)) / n;
      const fp = path.join(dir, `f_${String(i).padStart(3, "0")}.jpg`);
      const r = await run(ENV.ffmpegPath, [
        "-y", "-ss", ts.toFixed(2), "-i", streamUrl,
        "-frames:v", "1", "-vf", "scale=1280:-2", "-q:v", "4", fp,
      ], 90_000);
      if (r.code !== 0) continue;
      const st = await fs.stat(fp).catch(() => null);
      if (!st || st.size < MIN_CONTENT_BYTES) continue; // preto/vazio
      out.push({ buffer: await fs.readFile(fp), caption: `Captura ${out.length + 1}` });
    }
    return out;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---- Link direto (Google Drive / Dropbox / URL): baixa o arquivo pro storage ----
// O yt-dlp entende Google Drive (inclusive o aviso de vírus de arquivos grandes),
// Dropbox e URLs diretas. Sem cookies e sem anti-bot como o do YouTube.
export async function downloadVideoFromUrl(url: string, finalPath: string): Promise<void> {
  const dir = path.dirname(finalPath);
  await fs.mkdir(dir, { recursive: true });
  const tag = `._url_${crypto.randomUUID().slice(0, 8)}`;
  const outTmpl = path.join(dir, `${tag}.%(ext)s`);
  const args = ["--no-playlist", "--no-warnings", "-o", outTmpl, url];
  if (/[\\/]/.test(ENV.ffmpegPath)) args.push("--ffmpeg-location", ENV.ffmpegPath);
  const r = await run(ENV.ytDlpPath, args, 30 * 60 * 1000);
  const produced = (await fs.readdir(dir)).find(f => f.startsWith(tag));
  if (r.code !== 0 || !produced) {
    for (const f of (await fs.readdir(dir)).filter(f => f.startsWith(tag))) await fs.rm(path.join(dir, f), { force: true }).catch(() => {});
    throw new Error(`Falha ao baixar do link: ${r.stderr.slice(-800)}`);
  }
  await fs.rm(finalPath, { force: true }).catch(() => {});
  await fs.rename(path.join(dir, produced), finalPath);
}

// ---- Fallback: baixa o vídeo inteiro (<=720p) do YouTube ----
export async function downloadYoutubeVideo(url: string, finalPath: string): Promise<void> {
  const dir = path.dirname(finalPath);
  await fs.mkdir(dir, { recursive: true });
  const tag = `._ytdl_${crypto.randomUUID().slice(0, 8)}`;
  const outTmpl = path.join(dir, `${tag}.%(ext)s`);
  const args = [...ytCommon(), "-f", "bv*[height<=720]+ba/b[height<=720]/b", "--merge-output-format", "mp4", "-o", outTmpl];
  if (/[\\/]/.test(ENV.ffmpegPath)) args.push("--ffmpeg-location", ENV.ffmpegPath);
  args.push(url);
  const r = await run(ENV.ytDlpPath, args);
  const produced = (await fs.readdir(dir)).find(f => f.startsWith(tag));
  if (r.code !== 0 || !produced) {
    for (const f of (await fs.readdir(dir)).filter(f => f.startsWith(tag))) await fs.rm(path.join(dir, f), { force: true }).catch(() => {});
    throw new Error(`Falha ao baixar vídeo do YouTube: ${r.stderr.slice(-800)}`);
  }
  await fs.rm(finalPath, { force: true }).catch(() => {});
  await fs.rename(path.join(dir, produced), finalPath);
}
