// Classificação de frames via LLM multimodal (OpenRouter) + resolução dos marcadores
// {{SCREENSHOT:N}} que o gerador de spec insere no meio do texto.
//
// Objetivo: das capturas extraídas por detecção de cena (frameExtractor), descartar as que
// são só câmera/rosto/galeria de chamada e manter as que mostram conteúdo real (tela de app,
// planilha, dashboard, documento), com uma legenda factual em vez de "Captura N".
//
// Tudo aqui é best-effort: se o LLM falhar, degradamos para "mantém todas as capturas com a
// legenda original" — o mesmo comportamento de antes desta feature — sem derrubar o pipeline.
import { invokeLLM } from "./llm";
import type { ExtractedFrame } from "./frameExtractor";

export interface ClassifiedFrame extends ExtractedFrame {
  /** Posição estável da captura na lista original (0-indexed). É o N do marcador {{SCREENSHOT:N}}. */
  index: number;
  /** true = tela com conteúdo (manter); false = câmera/rosto/galeria (descartar). */
  keep: boolean;
  /** Contexto/etapa que a tela representa — ajuda o gerador a posicioná-la perto do texto certo. */
  stageHint: string;
}

const CLASSIFY_SYSTEM = `Você classifica capturas de tela extraídas de uma gravação de reunião.
Para CADA imagem, decida se ela mostra CONTEÚDO ÚTIL de tela compartilhada — como um sistema/app,
planilha, tabela, dashboard, formulário, documento, código ou protótipo — ou se é apenas VÍDEO DE
CÂMERA (rosto de participante, galeria de webcams, sala vazia, tela de espera).

Regras:
- keep = true SOMENTE se a imagem for majoritariamente uma tela/documento com informação legível.
- keep = false para qualquer imagem que seja essencialmente pessoas/câmera/galeria de vídeo, mesmo
  que tenha uma faixa fina de conteúdo ao fundo.
- caption: uma legenda curta e factual do que a tela mostra (ex.: "Lista de referências de cor por
  status", "Formulário de envio de amostra"). NÃO invente; descreva só o que dá pra ver. Para
  imagens com keep=false, a caption pode ser "Câmera dos participantes".
- stageHint: em poucas palavras, a etapa/assunto que a tela representa no fluxo (ex.: "visão geral
  da lista", "detalhe do item", "sistema atual de referência"). Vazio se não der pra inferir.

Responda SOMENTE com JSON no formato { "frames": [ { "index", "keep", "caption", "stageHint" }, ... ] },
um objeto por imagem, na mesma ordem e quantidade das imagens recebidas.`;

const CLASSIFY_SCHEMA = {
  type: "object",
  properties: {
    frames: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "Índice 0-based da imagem, na ordem recebida" },
          keep: { type: "boolean", description: "true se for tela com conteúdo; false se for câmera/galeria" },
          caption: { type: "string", description: "Legenda factual curta do que a tela mostra" },
          stageHint: { type: "string", description: "Etapa/assunto que a tela representa (pode ser vazio)" },
        },
        required: ["index", "keep", "caption", "stageHint"],
        additionalProperties: false,
      },
    },
  },
  required: ["frames"],
  additionalProperties: false,
};

interface RawClassification {
  index: number;
  keep: boolean;
  caption: string;
  stageHint: string;
}

// Mesmo parse defensivo usado em documentGenerator: json_schema strict deveria bastar, mas o
// próprio time não confia 100% nele — daí o fallback por regex de objeto.
function parseFramesJson(content: string): RawClassification[] | null {
  const tryParse = (s: string): RawClassification[] | null => {
    try {
      const obj = JSON.parse(s);
      if (obj && Array.isArray(obj.frames)) return obj.frames as RawClassification[];
    } catch { /* ignore */ }
    return null;
  };
  return tryParse(content) ?? tryParse(content.match(/\{[\s\S]*\}/)?.[0] ?? "");
}

export async function classifyFrames(frames: ExtractedFrame[]): Promise<ClassifiedFrame[]> {
  if (!frames.length) return [];

  // Degradação segura: mantém tudo, com a legenda original — comportamento pré-feature.
  const fallback = (): ClassifiedFrame[] =>
    frames.map((f, i) => ({ ...f, index: i, keep: true, stageHint: "" }));

  try {
    const content: any[] = [
      {
        type: "text",
        text: `São ${frames.length} imagens numeradas de 0 a ${frames.length - 1}, na ordem abaixo. `
          + `Classifique cada uma.`,
      },
    ];
    frames.forEach((f, i) => {
      content.push({ type: "text", text: `Imagem ${i}:` });
      content.push({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${f.buffer.toString("base64")}`, detail: "low" },
      });
    });

    const response = await invokeLLM({
      messages: [
        { role: "system", content: CLASSIFY_SYSTEM },
        { role: "user", content },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "frame_classification", strict: true, schema: CLASSIFY_SCHEMA },
      } as any,
    });

    const raw = response.choices[0]?.message?.content;
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    const parsed = parseFramesJson(text);
    if (!parsed) return fallback();

    // Realinha por índice retornado (tolerante a ordem/faltas), preservando a posição original.
    const byReturnedIndex = new Map<number, RawClassification>();
    for (const c of parsed) {
      if (typeof c?.index === "number") byReturnedIndex.set(c.index, c);
    }

    return frames.map((f, i) => {
      const c = byReturnedIndex.get(i);
      if (!c) return { ...f, index: i, keep: true, stageHint: "" }; // sem info → mantém (seguro)
      const caption = (c.caption || "").trim() || f.caption;
      return { ...f, index: i, keep: c.keep !== false, caption, stageHint: (c.stageHint || "").trim() };
    });
  } catch (e) {
    console.warn("[Classify] classificação de frames falhou, mantendo todas:", e);
    return fallback();
  }
}

// ===================== Marcadores {{SCREENSHOT:N}} =====================

const TOKEN_RE = /\{\{\s*SCREENSHOT\s*:\s*(\d+)\s*\}\}/gi;

/**
 * Normaliza os marcadores {{SCREENSHOT:N}} no markdown gerado pelo LLM. Fonte ÚNICA de verdade
 * sobre quais marcadores são válidos/únicos — para o DOCX e a visualização web nunca divergirem.
 *
 * - Só aceita N que exista entre os frames com keep=true (ignora índice alucinado ou de frame
 *   descartado).
 * - Deduplica: se o mesmo N aparecer mais de uma vez, mantém a 1ª e remove as demais.
 * - Marcadores válidos viram uma linha isolada canônica (\n\n{{SCREENSHOT:N}}\n\n), fáceis de os
 *   dois consumidores reconhecerem por igualdade exata; inválidos são removidos do texto.
 *
 * Retorna o markdown normalizado + o conjunto de índices efetivamente usados (para a galeria final
 * mostrar só o que sobrou).
 */
export function resolveScreenshotTokens(
  markdown: string,
  keepFrames: ClassifiedFrame[]
): { markdown: string; usedIndices: Set<number> } {
  const valid = new Set(keepFrames.map(f => f.index));
  const used = new Set<number>();
  const normalized = markdown.replace(TOKEN_RE, (_m, digits: string) => {
    const n = Number(digits);
    if (!valid.has(n) || used.has(n)) return ""; // inválido, descartado ou duplicado
    used.add(n);
    return `\n\n{{SCREENSHOT:${n}}}\n\n`;
  });
  return { markdown: normalized, usedIndices: used };
}

/** Reconhece uma linha que é exatamente um marcador canônico já normalizado. */
export function matchCanonicalToken(line: string): number | null {
  const m = line.trim().match(/^\{\{SCREENSHOT:(\d+)\}\}$/);
  return m ? Number(m[1]) : null;
}

// ===================== Markdown persistido (visualização web) =====================
// Estas funções montam o markdown salvo no banco (com URLs de imagem), compartilhado pelo
// pipeline real (routers) e pelo script de teste (gen-both) — para não divergirem.

/** Galeria de capturas em markdown: `![legenda](url)` para cada frame que tem URL. */
export function galleryMarkdown(frames: ClassifiedFrame[], urlByIndex: Map<number, string>): string {
  const withUrl = frames.filter(f => urlByIndex.has(f.index));
  if (!withUrl.length) return "";
  let md = `\n\n---\n\n## Capturas de Tela de Referência\n`;
  for (const f of withUrl) md += `\n![${f.caption}](${urlByIndex.get(f.index)})\n\n*${f.caption}*\n`;
  return md;
}

/**
 * Markdown web da SPEC: substitui cada {{SCREENSHOT:N}} pela imagem na posição certa e adiciona as
 * capturas mantidas não-usadas numa galeria no fim. Usa a MESMA resolveScreenshotTokens do DOCX.
 */
export function buildSpecWebMarkdown(
  markdown: string, keptFrames: ClassifiedFrame[], urlByIndex: Map<number, string>
): string {
  const { markdown: normMd, usedIndices } = resolveScreenshotTokens(markdown, keptFrames);
  const byIndex = new Map(keptFrames.map(f => [f.index, f]));
  const web = normMd.replace(/^\s*\{\{SCREENSHOT:(\d+)\}\}\s*$/gm, (_m, d: string) => {
    const n = Number(d);
    const f = byIndex.get(n);
    const url = urlByIndex.get(n);
    if (!f || !url) return "";
    return `![${f.caption}](${url})\n\n*${f.caption}*`;
  });
  const leftover = keptFrames.filter(f => !usedIndices.has(f.index));
  return web + galleryMarkdown(leftover, urlByIndex);
}
