import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ShadingType,
  PageBreak,
  Header,
  Footer,
  ImageRun,
  LevelFormat,
} from "docx";
import type { DeloitteDocument, SpecDocument } from "./documentGenerator";
import { jpegSize, type ExtractedFrame } from "./_core/frameExtractor";
import { resolveScreenshotTokens, matchCanonicalToken, type ClassifiedFrame } from "./_core/frameClassifier";

const MAX_IMG_W = 560; // largura útil da página (px @96dpi)

// Uma captura (imagem + legenda) — reaproveitado tanto inline (no meio do texto) quanto na galeria.
function renderScreenshotBlock(frame: ExtractedFrame): Block[] {
  const { width, height } = jpegSize(frame.buffer);
  const w = Math.min(MAX_IMG_W, width);
  const h = Math.round((height / width) * w);
  return [
    new Paragraph({
      children: [new ImageRun({ type: "jpg", data: frame.buffer, transformation: { width: w, height: h } })],
      spacing: { before: 160, after: 40 },
    }),
    new Paragraph({
      children: [new TextRun({ text: frame.caption, italics: true, color: "86888A", size: 18, font: "Calibri" })],
      spacing: { after: 160 },
    }),
  ];
}

function screenshotBlocks(frames: ExtractedFrame[]): Block[] {
  if (!frames.length) return [];
  const blocks: Block[] = [
    new Paragraph({
      children: [new TextRun({ text: "Capturas de Tela de Referência", bold: true, color: "003087", size: 28, font: "Calibri" })],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 480, after: 240 },
      border: { bottom: { color: "003087", size: 12, style: BorderStyle.SINGLE } },
    }),
  ];
  for (const f of frames) blocks.push(...renderScreenshotBlock(f));
  return blocks;
}

// Bloco de participantes no cabeçalho (após a capa). Só renderiza se houver nomes.
function participantsBlock(participants?: { names: string[]; possiblyIncomplete: boolean } | null): Block[] {
  if (!participants || !participants.names.length) return [];
  const blocks: Block[] = [
    new Paragraph({
      children: [new TextRun({ text: "Participantes", bold: true, color: "003087", size: 24, font: "Calibri" })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 120, after: 120 },
      border: { bottom: { color: "003087", size: 6, style: BorderStyle.SINGLE } },
    }),
    new Paragraph({
      children: [new TextRun({ text: participants.names.join("  ·  "), font: "Calibri", size: 22, color: "1A1A1A" })],
      spacing: { after: participants.possiblyIncomplete ? 40 : 240 },
    }),
  ];
  if (participants.possiblyIncomplete) {
    blocks.push(new Paragraph({
      children: [new TextRun({ text: "Lista possivelmente incompleta — nem todos os nomes estavam legíveis nos quadros de vídeo.", italics: true, color: "86888A", size: 18, font: "Calibri" })],
      spacing: { after: 240 },
    }));
  }
  return blocks;
}

type Block = Paragraph | Table;

const isTableLine = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isTableSeparator = (l: string) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes("-");

function splitCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map(c => c.trim());
}

function inlineRuns(text: string, opts: { bold?: boolean; size?: number } = {}): TextRun[] {
  const size = opts.size ?? 22;
  const runs: TextRun[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  for (const part of parts) {
    if (part.startsWith("**") && part.endsWith("**")) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true, font: "Calibri", size }));
    } else if (part.startsWith("*") && part.endsWith("*")) {
      runs.push(new TextRun({ text: part.slice(1, -1), italics: true, font: "Calibri", size }));
    } else if (part.startsWith("`") && part.endsWith("`")) {
      runs.push(new TextRun({ text: part.slice(1, -1), font: "Consolas", size: size - 2 }));
    } else if (part) {
      runs.push(new TextRun({ text: part, bold: opts.bold, font: "Calibri", size }));
    }
  }
  if (runs.length === 0) runs.push(new TextRun({ text: "", font: "Calibri", size }));
  return runs;
}

function buildTable(lines: string[]): Table {
  const rows = lines.filter(l => !isTableSeparator(l)).map(splitCells);
  const colCount = Math.max(...rows.map(r => r.length));
  const tableRows = rows.map((cells, rowIdx) => {
    const isHeader = rowIdx === 0;
    const padded = [...cells];
    while (padded.length < colCount) padded.push("");
    return new TableRow({
      tableHeader: isHeader,
      children: padded.map(cell =>
        new TableCell({
          width: { size: Math.floor(100 / colCount), type: WidthType.PERCENTAGE },
          shading: isHeader ? { type: ShadingType.CLEAR, fill: "003087", color: "auto" } : undefined,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [new Paragraph({
            children: isHeader
              ? [new TextRun({ text: cell.replace(/[*`]/g, ""), bold: true, color: "FFFFFF", font: "Calibri", size: 20 })]
              : inlineRuns(cell, { size: 20 }),
          })],
        })
      ),
    });
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: tableRows,
  });
}

export function parseMarkdownToBlocks(markdown: string, frameByIndex?: Map<number, ExtractedFrame>): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Marcador de captura canônico (já normalizado por resolveScreenshotTokens): {{SCREENSHOT:N}}
    // sozinho na linha. Renderiza a imagem ali. Sem o mapa (ex.: Deloitte), a linha é ignorada
    // em vez de virar texto literal.
    const tokenIdx = matchCanonicalToken(line);
    if (tokenIdx !== null) {
      const frame = frameByIndex?.get(tokenIdx);
      if (frame) blocks.push(...renderScreenshotBlock(frame));
      i++;
      continue;
    }

    // Fenced code blocks (```), incl. mermaid/diagramas — não renderizamos como código cru.
    if (line.trim().startsWith("```")) {
      const lang = line.trim().replace(/`/g, "").toLowerCase();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++; // pula a fence de fechamento
      const isDiagram = /mermaid|graphviz|dot|plantuml|sequence|flowchart/.test(lang);
      if (isDiagram) {
        blocks.push(new Paragraph({
          children: [new TextRun({ text: "[Diagrama descrito no texto acima]", italics: true, color: "86888A", font: "Calibri", size: 20 })],
          spacing: { before: 80, after: 80 },
        }));
      } else {
        for (const c of code) {
          blocks.push(new Paragraph({
            children: [new TextRun({ text: c, font: "Consolas", size: 20 })],
            spacing: { before: 20, after: 20 },
          }));
        }
      }
      continue;
    }

    // Tabela Markdown
    if (isTableLine(line)) {
      const tbl: string[] = [];
      while (i < lines.length && isTableLine(lines[i])) {
        tbl.push(lines[i]);
        i++;
      }
      if (tbl.length >= 2) {
        blocks.push(buildTable(tbl));
        blocks.push(new Paragraph({ text: "", spacing: { after: 120 } }));
        continue;
      }
      // não é tabela de verdade — cai pro parágrafo normal
    }

    if (line.startsWith("### ")) {
      blocks.push(new Paragraph({ text: line.replace("### ", ""), heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 100 } }));
    } else if (line.startsWith("## ")) {
      blocks.push(new Paragraph({ text: line.replace("## ", ""), heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 150 } }));
    } else if (line.startsWith("# ")) {
      blocks.push(new Paragraph({ text: line.replace("# ", ""), heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }));
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      blocks.push(new Paragraph({ children: inlineRuns(line.replace(/^[-*] /, "")), bullet: { level: 0 }, spacing: { before: 60, after: 60 } }));
    } else if (line.match(/^\d+\. /)) {
      blocks.push(new Paragraph({ children: inlineRuns(line.replace(/^\d+\. /, "")), numbering: { reference: "default-numbering", level: 0 }, spacing: { before: 60, after: 60 } }));
    } else if (line.startsWith("---")) {
      blocks.push(new Paragraph({ text: "", border: { bottom: { color: "86888A", size: 6, style: BorderStyle.SINGLE } }, spacing: { before: 200, after: 200 } }));
    } else if (line.trim() === "") {
      blocks.push(new Paragraph({ text: "", spacing: { before: 80, after: 80 } }));
    } else {
      blocks.push(new Paragraph({ children: inlineRuns(line), spacing: { before: 80, after: 80 } }));
    }
    i++;
  }
  return blocks;
}

function sectionHeader(title: string, number: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: `${number}. ${title}`, bold: true, color: "003087", size: 28, font: "Calibri" })],
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 480, after: 240 },
    border: { bottom: { color: "003087", size: 12, style: BorderStyle.SINGLE } },
  });
}

function coverAndShell(
  title: string, subtitle: string, headerLabel: string, footerLabel: string, body: Block[],
  participants?: { names: string[]; possiblyIncomplete: boolean } | null
): Document {
  const cover: Block[] = [
    new Paragraph({ children: [new TextRun({ text: "", break: 1 })], spacing: { before: 2000 } }),
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, color: "003087", size: 48, font: "Calibri Light" })],
      alignment: AlignmentType.CENTER, spacing: { before: 400, after: 200 },
    }),
    new Paragraph({
      children: [new TextRun({ text: subtitle, color: "86888A", size: 28, font: "Calibri" })],
      alignment: AlignmentType.CENTER, spacing: { after: 100 },
    }),
    new Paragraph({ children: [new PageBreak()] }),
    ...participantsBlock(participants),
  ];

  return new Document({
    creator: "VideoDoc",
    title,
    numbering: {
      config: [{
        reference: "default-numbering",
        levels: [{
          level: 0,
          format: LevelFormat.DECIMAL,
          text: "%1.",
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 540, hanging: 260 } } },
        }],
      }],
    },
    styles: {
      default: { document: { run: { font: "Calibri", size: 22, color: "1A1A1A" }, paragraph: { spacing: { line: 276 } } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", run: { bold: true, color: "003087", size: 28, font: "Calibri" } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", run: { bold: true, color: "003087", size: 24, font: "Calibri" } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", run: { bold: true, color: "003087", size: 22, font: "Calibri" } },
      ],
    },
    sections: [{
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: headerLabel, color: "86888A", size: 18, font: "Calibri" })], alignment: AlignmentType.RIGHT, border: { bottom: { color: "003087", size: 4, style: BorderStyle.SINGLE } } })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ children: [new TextRun({ text: footerLabel, color: "86888A", size: 18, font: "Calibri" })], alignment: AlignmentType.CENTER, border: { top: { color: "86888A", size: 2, style: BorderStyle.SINGLE } } })] }) },
      children: [...cover, ...body],
    }],
  });
}

export async function generateDocx(
  doc: DeloitteDocument,
  screenshots: ExtractedFrame[] = [],
  participants?: { names: string[]; possiblyIncomplete: boolean } | null
): Promise<Buffer> {
  // Deloitte: sem marcadores inline (o prompt não os usa). As capturas — já filtradas e com
  // legenda factual — entram na galeria no fim, como antes.
  const body: Block[] = [
    sectionHeader("Visão Executiva", "1"), ...parseMarkdownToBlocks(doc.executiveSummary),
    sectionHeader("Processo Ponta a Ponta", "2"), ...parseMarkdownToBlocks(doc.endToEndProcess),
    sectionHeader("Responsabilidades", "3"), ...parseMarkdownToBlocks(doc.responsibilities),
    sectionHeader("Riscos", "4"), ...parseMarkdownToBlocks(doc.risks),
    sectionHeader("Recomendações", "5"), ...parseMarkdownToBlocks(doc.recommendations),
    sectionHeader("Próximos Passos", "6"), ...parseMarkdownToBlocks(doc.nextSteps),
    ...screenshotBlocks(screenshots),
  ];
  const docx = coverAndShell(doc.title, "Documentação Consultiva", "VideoDoc | Padrão Deloitte", "Confidencial — Para uso interno", body, participants);
  return await Packer.toBuffer(docx);
}

export async function generateSpecDocx(
  spec: SpecDocument,
  screenshots: ClassifiedFrame[] = [],
  participants?: { names: string[]; possiblyIncomplete: boolean } | null
): Promise<Buffer> {
  // A especificação já vem como markdown completo (com # título). Removemos o
  // primeiro H1 da capa para não duplicar com o título.
  const md = spec.markdown.replace(/^\s*#\s+.*\n/, "");

  // Só as capturas mantidas podem virar marcador. resolveScreenshotTokens valida/deduplica os
  // {{SCREENSHOT:N}} e diz quais índices foram efetivamente usados no texto.
  const kept = screenshots.filter(f => f.keep);
  const { markdown: normalizedMd, usedIndices } = resolveScreenshotTokens(md, kept);
  const byIndex = new Map<number, ExtractedFrame>(kept.map(f => [f.index, f]));

  const body: Block[] = [...parseMarkdownToBlocks(normalizedMd, byIndex)];

  // Capturas mantidas que o modelo não posicionou no texto ainda aparecem — na galeria final —
  // para nenhuma captura relevante sumir silenciosamente.
  const leftover = kept.filter(f => !usedIndices.has(f.index));
  if (leftover.length) body.push(...screenshotBlocks(leftover));

  const docx = coverAndShell(spec.title, "Especificação Técnica", "VideoDoc | Especificação Técnica", "Documento técnico — Para a equipe de desenvolvimento", body, participants);
  return await Packer.toBuffer(docx);
}
