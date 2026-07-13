/**
 * Transcrição de áudio self-hosted.
 *
 * Pipeline:
 *   1. Obtém o áudio:
 *      - YouTube  -> baixa com yt-dlp (extrai trilha de áudio)
 *      - arquivo local (upload já no disco) -> extrai/normaliza áudio com ffmpeg
 *      - URL http(s) -> baixa e normaliza com ffmpeg
 *   2. Roda Whisper local (faster-whisper) via scripts/transcribe.py
 *   3. Devolve { text, language, segments } no mesmo formato esperado pelo router.
 */
import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { ENV } from "./env";

export type TranscribeOptions = {
  audioUrl: string; // URL do YouTube/http OU caminho absoluto de arquivo local
  isYoutube?: boolean;
  language?: string;
  prompt?: string;
};

export type WhisperSegment = {
  id: number;
  start: number;
  end: number;
  text: string;
};

export type WhisperResponse = {
  task: "transcribe";
  language: string;
  duration: number;
  text: string;
  segments: WhisperSegment[];
};

export type TranscriptionResponse = WhisperResponse;

export type TranscriptionError = {
  error: string;
  code: "FILE_TOO_LARGE" | "INVALID_FORMAT" | "TRANSCRIPTION_FAILED" | "UPLOAD_FAILED" | "SERVICE_ERROR";
  details?: string;
};

function run(cmd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          killed = true;
          child.kill("SIGKILL");
        }, opts.timeoutMs)
      : null;
    child.stdout.on("data", d => (stdout += d.toString()));
    child.stderr.on("data", d => (stderr += d.toString()));
    child.on("error", err => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + `\n[spawn error] ${String(err)}` });
    });
    child.on("close", code => {
      if (timer) clearTimeout(timer);
      resolve({ code: killed ? -2 : code ?? -1, stdout, stderr });
    });
  });
}

const isHttp = (s: string) => /^https?:\/\//i.test(s);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function transcribeAudio(
  options: TranscribeOptions,
): Promise<TranscriptionResponse | TranscriptionError> {
  const workDir = path.join(os.tmpdir(), `vdoc-${crypto.randomUUID().slice(0, 8)}`);
  const audioWav = path.join(workDir, "audio.wav");

  try {
    await fs.mkdir(workDir, { recursive: true });

    // ---- Passo 1: obter o áudio como WAV mono 16kHz ----
    if (options.isYoutube || (isHttp(options.audioUrl) && /youtu\.?be/i.test(options.audioUrl))) {
      // yt-dlp baixa e (com ffmpeg) extrai a melhor trilha de áudio
      const ytOut = path.join(workDir, "yt.%(ext)s");
      const ytArgs = [
        "-x",
        "--audio-format", "wav",
        "--postprocessor-args", "ffmpeg:-ar 16000 -ac 1",
        "-o", ytOut,
        "--no-playlist",
        "--no-warnings",
      ];
      // Só passa --ffmpeg-location se for caminho absoluto/diretório (senão yt-dlp acha no PATH)
      if (/[\\/]/.test(ENV.ffmpegPath)) ytArgs.push("--ffmpeg-location", ENV.ffmpegPath);
      // Cookies (opcional) driblam o bloqueio "confirm you're not a bot"
      if (ENV.ytdlpCookies) ytArgs.push("--cookies", ENV.ytdlpCookies);
      ytArgs.push(options.audioUrl);
      const yt = await run(
        ENV.ytDlpPath,
        ytArgs,
        { timeoutMs: 15 * 60 * 1000 },
      );
      if (yt.code !== 0) {
        return { error: "Falha ao baixar áudio do YouTube", code: "INVALID_FORMAT", details: yt.stderr.slice(-1500) };
      }
      // yt-dlp gera yt.wav
      const generated = path.join(workDir, "yt.wav");
      await fs.rename(generated, audioWav).catch(async () => {
        // fallback: pega qualquer .wav gerado
        const files = await fs.readdir(workDir);
        const wav = files.find(f => f.endsWith(".wav"));
        if (wav) await fs.rename(path.join(workDir, wav), audioWav);
        else throw new Error("yt-dlp não produziu arquivo wav");
      });
    } else {
      // Arquivo local (upload) ou URL http direta -> normaliza com ffmpeg.
      // ffmpeg aceita tanto caminho local quanto URL http como input.
      const input = options.audioUrl;
      const ff = await run(
        ENV.ffmpegPath,
        ["-y", "-i", input, "-vn", "-ar", "16000", "-ac", "1", "-f", "wav", audioWav],
        { timeoutMs: 15 * 60 * 1000 },
      );
      if (ff.code !== 0) {
        return { error: "Falha ao extrair áudio do vídeo", code: "INVALID_FORMAT", details: ff.stderr.slice(-1500) };
      }
    }

    // ---- Passo 2: transcrição ----
    if (ENV.transcribeProvider === "local") {
      return await transcribeLocal(audioWav, options);
    }
    return await transcribeGroq(audioWav, options);
  } catch (error) {
    return {
      error: "Falha inesperada na transcrição",
      code: "SERVICE_ERROR",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Limite de tamanho de arquivo da Groq é ~25MB. Usamos blocos de 8 min:
// wav 16kHz mono s16le ≈ 32KB/s → 8min ≈ 15MB, com folga sob o limite.
const GROQ_CHUNK_SECONDS = 480;
const GROQ_MAX_BYTES = 24 * 1024 * 1024;

// ---- Provider: Groq (Whisper hospedado, API compatível com OpenAI) ----
async function transcribeGroq(
  audioWav: string,
  options: TranscribeOptions,
): Promise<TranscriptionResponse | TranscriptionError> {
  if (!ENV.groqApiKey) {
    return { error: "GROQ_API_KEY não configurada", code: "SERVICE_ERROR" };
  }

  const stat = await fs.stat(audioWav);

  // Áudio pequeno: uma única requisição.
  if (stat.size <= GROQ_MAX_BYTES) {
    return groqTranscribeFile(audioWav, options, 0);
  }

  // Áudio grande: fatia em blocos de GROQ_CHUNK_SECONDS e transcreve cada um.
  const workDir = path.dirname(audioWav);
  const pattern = path.join(workDir, "chunk_%03d.wav");
  const seg = await run(
    ENV.ffmpegPath,
    ["-y", "-i", audioWav, "-f", "segment", "-segment_time", String(GROQ_CHUNK_SECONDS),
     "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", pattern],
    { timeoutMs: 15 * 60 * 1000 },
  );
  if (seg.code !== 0) {
    return { error: "Falha ao fatiar o áudio", code: "SERVICE_ERROR", details: seg.stderr.slice(-1000) };
  }

  const chunks = (await fs.readdir(workDir))
    .filter(f => /^chunk_\d+\.wav$/.test(f))
    .sort()
    .map(f => path.join(workDir, f));

  if (chunks.length === 0) {
    return { error: "Nenhum bloco de áudio gerado", code: "SERVICE_ERROR" };
  }

  const texts: string[] = [];
  const segments: WhisperSegment[] = [];
  let segId = 0;
  for (let i = 0; i < chunks.length; i++) {
    const offset = i * GROQ_CHUNK_SECONDS;
    const part = await groqTranscribeFile(chunks[i], options, offset);
    if ("error" in part) {
      return { ...part, details: `bloco ${i + 1}/${chunks.length}: ${part.details ?? part.error}` };
    }
    texts.push(part.text);
    for (const s of part.segments) segments.push({ ...s, id: segId++ });
    if (i < chunks.length - 1) await sleep(2000); // respeita o rate limit da Groq
  }

  return {
    task: "transcribe",
    language: options.language ?? "pt",
    duration: chunks.length * GROQ_CHUNK_SECONDS,
    text: texts.join(" ").trim(),
    segments,
  };
}

// Transcreve UM arquivo de áudio via Groq. `offset` desloca os timestamps dos segmentos.
async function groqTranscribeFile(
  audioFile: string,
  options: TranscribeOptions,
  offset: number,
  attempt = 0,
): Promise<TranscriptionResponse | TranscriptionError> {
  const buf = await fs.readFile(audioFile);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)], { type: "audio/wav" }), "audio.wav");
  form.append("model", ENV.groqModel);
  form.append("response_format", "verbose_json");
  if (options.language) form.append("language", options.language);
  if (options.prompt) form.append("prompt", options.prompt);

  const url = `${ENV.groqApiUrl.replace(/\/+$/, "")}/audio/transcriptions`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${ENV.groqApiKey}` },
    body: form,
  });

  // Rate limit (429): a Groq informa quanto esperar em Retry-After. Aguarda e tenta de novo.
  if (resp.status === 429 && attempt < 6) {
    const ra = parseFloat(resp.headers.get("retry-after") ?? "");
    const waitSec = Number.isFinite(ra) && ra > 0 ? Math.min(ra, 300) : Math.min(10 * Math.pow(2, attempt), 120);
    await sleep((waitSec + 1) * 1000);
    return groqTranscribeFile(audioFile, options, offset, attempt + 1);
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    const friendly = resp.status === 429
      ? "Limite de uso da Groq atingido. Aguarde alguns minutos e tente novamente, ou use um vídeo menor."
      : "Transcrição (Groq) falhou";
    return {
      error: friendly,
      code: "TRANSCRIPTION_FAILED",
      details: `${resp.status} ${resp.statusText}: ${detail.slice(0, 800)}`,
    };
  }

  const data = (await resp.json()) as any;
  if (typeof data?.text !== "string") {
    return { error: "Resposta de transcrição inválida (Groq)", code: "SERVICE_ERROR" };
  }
  return {
    task: "transcribe",
    language: data.language ?? options.language ?? "pt",
    duration: data.duration ?? 0,
    text: data.text,
    segments: (data.segments ?? []).map((s: any, i: number) => ({
      id: s.id ?? i,
      start: (s.start ?? 0) + offset,
      end: (s.end ?? 0) + offset,
      text: s.text ?? "",
    })),
  };
}

// ---- Provider: Whisper local (faster-whisper via scripts/transcribe.py) ----
async function transcribeLocal(
  audioWav: string,
  options: TranscribeOptions,
): Promise<TranscriptionResponse | TranscriptionError> {
  const args = [
    ENV.whisperScript,
    "--audio", audioWav,
    "--model", ENV.whisperModel,
  ];
  if (options.language) args.push("--language", options.language);
  if (options.prompt) args.push("--prompt", options.prompt);

  const wh = await run(ENV.whisperPython, args, { timeoutMs: 30 * 60 * 1000 });
  if (wh.code !== 0) {
    return {
      error: "Serviço de transcrição falhou",
      code: "TRANSCRIPTION_FAILED",
      details: (wh.stderr || wh.stdout).slice(-1500),
    };
  }

  const jsonLine = wh.stdout.trim().split("\n").filter(Boolean).pop() ?? "";
  let parsed: any;
  try {
    parsed = JSON.parse(jsonLine);
  } catch {
    return { error: "Resposta de transcrição inválida", code: "SERVICE_ERROR", details: jsonLine.slice(0, 500) };
  }
  if (!parsed?.text || typeof parsed.text !== "string") {
    return { error: "Transcrição vazia ou inválida", code: "SERVICE_ERROR", details: "campo text ausente" };
  }
  return {
    task: "transcribe",
    language: parsed.language ?? options.language ?? "pt",
    duration: parsed.duration ?? 0,
    text: parsed.text,
    segments: parsed.segments ?? [],
  };
}
