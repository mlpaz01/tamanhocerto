// Extração best-effort dos PARTICIPANTES da reunião a partir de quadros iniciais do vídeo.
//
// Ideia: no começo da chamada, antes de alguém compartilhar tela, a galeria de vídeo costuma
// mostrar os quadros das câmeras grandes o bastante para o nome aparecer legível embaixo de cada
// um. Pegamos alguns frames cedo e pedimos ao LLM (visão) para ler esses nomes.
//
// É totalmente best-effort: se a reunião já começa em compartilhamento de tela, se os quadros são
// pequenos, ou se o LLM falha, retornamos lista vazia (com possiblyIncomplete=true) sem NUNCA
// derrubar o pipeline.
import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { ENV } from "./env";
import { invokeLLM } from "./llm";

// run()/probeDuration() são duplicados de propósito (mesmo padrão já usado em frameExtractor e
// voiceTranscription) — não vale acoplar módulos _core por ~15 linhas de spawn.
function run(cmd: string, args: string[], timeoutMs = 120_000): Promise<{ code: number; stdout: string; stderr: string }> {
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
  const probe = ENV.ffmpegPath.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");
  const r = await run(probe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", videoPath], 60_000);
  const d = parseFloat(r.stdout.trim());
  return Number.isFinite(d) ? d : 0;
}

// Momentos cedo na reunião — quanto mais cedo, menos gente entrou e maiores os quadros.
const CANDIDATE_TIMESTAMPS = [20, 60, 150, 300];

export interface ParticipantsResult {
  names: string[];
  possiblyIncomplete: boolean;
}

const PARTICIPANTS_SYSTEM = `Você recebe alguns quadros do INÍCIO de uma gravação de reunião por
vídeo (Google Meet / Teams / Zoom), na visão de galeria de câmeras. Sob cada quadro de
participante costuma aparecer o NOME da pessoa.

Sua tarefa: listar os nomes de participantes que você consegue LER claramente nos quadros.

Regras:
- Retorne apenas nomes REALMENTE visíveis e legíveis. NÃO invente, não complete nomes cortados,
  não deduza.
- Deduplique (a mesma pessoa pode aparecer em mais de um quadro).
- Ignore rótulos que não são nome de pessoa (ex.: "Sala de reunião", nomes de dispositivo).
- Se a galeria indicar mais participantes do que os quadros visíveis (ex.: um contador "17
  pessoas" mas só alguns quadros aparecem), ou se algum nome estiver ilegível/cortado, marque
  possiblyIncomplete = true.
- Se nenhum nome for legível, retorne names vazio e possiblyIncomplete = true.

Responda SOMENTE com JSON { "names": ["..."], "possiblyIncomplete": true|false }.`;

const PARTICIPANTS_SCHEMA = {
  type: "object",
  properties: {
    names: { type: "array", items: { type: "string" }, description: "Nomes de participantes legíveis" },
    possiblyIncomplete: { type: "boolean", description: "true se a lista pode não estar completa" },
  },
  required: ["names", "possiblyIncomplete"],
  additionalProperties: false,
};

function cleanNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of raw) {
    if (typeof n !== "string") continue;
    const name = n.trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 80) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export async function extractParticipants(videoPath: string): Promise<ParticipantsResult> {
  const empty: ParticipantsResult = { names: [], possiblyIncomplete: true };
  const dir = path.join(os.tmpdir(), `vdoc-people-${crypto.randomUUID().slice(0, 8)}`);

  try {
    const dur = await probeDuration(videoPath);
    const stamps = CANDIDATE_TIMESTAMPS.filter(t => dur <= 0 || t < dur);
    if (!stamps.length) return empty;

    await fs.mkdir(dir, { recursive: true });
    const buffers: Buffer[] = [];
    for (let i = 0; i < stamps.length; i++) {
      const out = path.join(dir, `p_${i}.jpg`);
      await run(ENV.ffmpegPath, [
        "-y", "-ss", stamps[i].toFixed(2), "-i", videoPath,
        "-frames:v", "1", "-vf", "scale=1280:-2", "-q:v", "2", out,
      ], 120_000);
      const buf = await fs.readFile(out).catch(() => null);
      if (buf) buffers.push(buf);
    }
    if (!buffers.length) return empty;

    const content: any[] = [
      { type: "text", text: "Quadros do início da reunião, em ordem cronológica. Leia os nomes dos participantes." },
    ];
    for (const buf of buffers) {
      content.push({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${buf.toString("base64")}`, detail: "high" },
      });
    }

    const response = await invokeLLM({
      messages: [
        { role: "system", content: PARTICIPANTS_SYSTEM },
        { role: "user", content },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "participants", strict: true, schema: PARTICIPANTS_SCHEMA },
      } as any,
    });

    const rawContent = response.choices[0]?.message?.content;
    const text = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
    let parsed: any = null;
    try { parsed = JSON.parse(text); }
    catch { const m = text.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch { /* ignore */ } } }
    if (!parsed) return empty;

    const names = cleanNames(parsed.names);
    // Se não achou nome, mantém incompleto; se achou, respeita a flag do modelo (default false).
    return { names, possiblyIncomplete: names.length === 0 ? true : parsed.possiblyIncomplete === true };
  } catch (e) {
    console.warn("[Participants] extração de participantes falhou:", e);
    return empty;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
