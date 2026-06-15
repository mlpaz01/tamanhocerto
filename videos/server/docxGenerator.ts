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
} from "docx";
import type { DeloitteDocument } from "./documentGenerator";

function parseMarkdownToDocxParagraphs(markdown: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const lines = markdown.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("### ")) {
      paragraphs.push(new Paragraph({
        text: line.replace("### ", ""),
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 200, after: 100 },
      }));
    } else if (line.startsWith("## ")) {
      paragraphs.push(new Paragraph({
        text: line.replace("## ", ""),
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 150 },
      }));
    } else if (line.startsWith("# ")) {
      paragraphs.push(new Paragraph({
        text: line.replace("# ", ""),
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 },
      }));
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      paragraphs.push(new Paragraph({
        text: line.replace(/^[-*] /, ""),
        bullet: { level: 0 },
        spacing: { before: 60, after: 60 },
      }));
    } else if (line.match(/^\d+\. /)) {
      paragraphs.push(new Paragraph({
        text: line.replace(/^\d+\. /, ""),
        numbering: { reference: "default-numbering", level: 0 },
        spacing: { before: 60, after: 60 },
      }));
    } else if (line.startsWith("---")) {
      paragraphs.push(new Paragraph({
        text: "",
        border: { bottom: { color: "86888A", size: 6, style: BorderStyle.SINGLE } },
        spacing: { before: 200, after: 200 },
      }));
    } else if (line.trim() === "") {
      paragraphs.push(new Paragraph({ text: "", spacing: { before: 80, after: 80 } }));
    } else {
      // Parse inline bold/italic
      const runs: TextRun[] = [];
      const parts = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
      for (const part of parts) {
        if (part.startsWith("**") && part.endsWith("**")) {
          runs.push(new TextRun({ text: part.slice(2, -2), bold: true, font: "Calibri", size: 22 }));
        } else if (part.startsWith("*") && part.endsWith("*")) {
          runs.push(new TextRun({ text: part.slice(1, -1), italics: true, font: "Calibri", size: 22 }));
        } else if (part) {
          runs.push(new TextRun({ text: part, font: "Calibri", size: 22 }));
        }
      }
      paragraphs.push(new Paragraph({
        children: runs,
        spacing: { before: 80, after: 80 },
      }));
    }
  }
  return paragraphs;
}

function sectionHeader(title: string, number: string): Paragraph[] {
  return [
    new Paragraph({
      children: [
        new TextRun({
          text: `${number}. ${title}`,
          bold: true,
          color: "003087",
          size: 28,
          font: "Calibri",
        }),
      ],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 480, after: 240 },
      border: {
        bottom: { color: "003087", size: 12, style: BorderStyle.SINGLE },
      },
    }),
  ];
}

export async function generateDocx(doc: DeloitteDocument): Promise<Buffer> {
  const sections = [
    // Cover page
    new Paragraph({
      children: [new TextRun({ text: "", break: 1 })],
      spacing: { before: 2000 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: doc.title,
          bold: true,
          color: "003087",
          size: 48,
          font: "Calibri Light",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 400, after: 200 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Documentação Consultiva",
          color: "86888A",
          size: 28,
          font: "Calibri",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 100 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Gerado em ${new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}`,
          color: "86888A",
          size: 22,
          font: "Calibri",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 400 },
    }),
    new Paragraph({
      children: [new PageBreak()],
    }),

    // Sections
    ...sectionHeader("Visão Executiva", "1"),
    ...parseMarkdownToDocxParagraphs(doc.executiveSummary),

    ...sectionHeader("Processo Ponta a Ponta", "2"),
    ...parseMarkdownToDocxParagraphs(doc.endToEndProcess),

    ...sectionHeader("Responsabilidades", "3"),
    ...parseMarkdownToDocxParagraphs(doc.responsibilities),

    ...sectionHeader("Riscos", "4"),
    ...parseMarkdownToDocxParagraphs(doc.risks),

    ...sectionHeader("Recomendações", "5"),
    ...parseMarkdownToDocxParagraphs(doc.recommendations),

    ...sectionHeader("Próximos Passos", "6"),
    ...parseMarkdownToDocxParagraphs(doc.nextSteps),

    // Footer note
    new Paragraph({
      children: [
        new TextRun({
          text: "Documento gerado automaticamente pela plataforma VideoDoc Consultivo",
          color: "86888A",
          size: 18,
          italics: true,
          font: "Calibri",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 600, after: 0 },
      border: { top: { color: "86888A", size: 4, style: BorderStyle.SINGLE } },
    }),
  ];

  const docxDoc = new Document({
    creator: "VideoDoc Consultivo",
    title: doc.title,
    description: "Documentação consultiva gerada automaticamente",
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 22, color: "1A1A1A" },
          paragraph: { spacing: { line: 276 } },
        },
      },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          run: { bold: true, color: "003087", size: 28, font: "Calibri" },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          run: { bold: true, color: "003087", size: 24, font: "Calibri" },
        },
        {
          id: "Heading3",
          name: "Heading 3",
          basedOn: "Normal",
          next: "Normal",
          run: { bold: true, color: "003087", size: 22, font: "Calibri" },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: "VideoDoc Consultivo | Padrão Deloitte", color: "86888A", size: 18, font: "Calibri" }),
                ],
                alignment: AlignmentType.RIGHT,
                border: { bottom: { color: "003087", size: 4, style: BorderStyle.SINGLE } },
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: "Confidencial — Para uso interno", color: "86888A", size: 18, font: "Calibri" }),
                ],
                alignment: AlignmentType.CENTER,
                border: { top: { color: "86888A", size: 2, style: BorderStyle.SINGLE } },
              }),
            ],
          }),
        },
        children: sections,
      },
    ],
  });

  return await Packer.toBuffer(docxDoc);
}
