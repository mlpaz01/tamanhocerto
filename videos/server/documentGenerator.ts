import { invokeLLM } from "./_core/llm";

export interface DeloitteDocument {
  title: string;
  executiveSummary: string;
  endToEndProcess: string;
  responsibilities: string;
  risks: string;
  recommendations: string;
  nextSteps: string;
}

const SYSTEM_PROMPT = `Você é um consultor sênior da Deloitte especializado em documentação de processos e transformação digital.
Sua tarefa é analisar a transcrição de uma reunião e gerar uma documentação estruturada e completa no padrão consultivo Deloitte.

A documentação deve ser profissional, objetiva, densa em conteúdo e seguir rigorosamente o estilo consultivo da Deloitte:
- Linguagem executiva, clara e direta
- Uso de estruturas lógicas e hierárquicas
- Foco em valor de negócio, riscos e recomendações acionáveis
- Tabelas e listas estruturadas quando aplicável
- Markdown bem formatado
- NÃO use blocos de código de diagrama (mermaid, graphviz, ASCII art); descreva fluxos e processos em texto, listas numeradas ou tabelas

Responda EXCLUSIVAMENTE com um JSON válido no seguinte formato (sem markdown code blocks, apenas o JSON puro):
{
  "title": "Título executivo do documento baseado no conteúdo da reunião",
  "executiveSummary": "Visão Executiva completa em markdown...",
  "endToEndProcess": "Processo Ponta a Ponta completo em markdown com tabelas e fluxos...",
  "responsibilities": "Responsabilidades completas em markdown com tabela RACI ou similar...",
  "risks": "Riscos completos em markdown com tabela de riscos, probabilidade e impacto...",
  "recommendations": "Recomendações completas em markdown com priorização...",
  "nextSteps": "Próximos Passos completos em markdown com prazo, responsável e entregável..."
}`;

export async function generateDeloitteDocument(transcription: string): Promise<DeloitteDocument> {
  const userMessage = `Analise a seguinte transcrição de reunião e gere a documentação consultiva completa no padrão Deloitte:

---
${transcription}
---

Gere o JSON com todas as seções preenchidas de forma detalhada e profissional.`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "deloitte_document",
        strict: true,
        schema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Título executivo do documento" },
            executiveSummary: { type: "string", description: "Visão Executiva em markdown" },
            endToEndProcess: { type: "string", description: "Processo Ponta a Ponta em markdown" },
            responsibilities: { type: "string", description: "Responsabilidades em markdown" },
            risks: { type: "string", description: "Riscos em markdown" },
            recommendations: { type: "string", description: "Recomendações em markdown" },
            nextSteps: { type: "string", description: "Próximos Passos em markdown" },
          },
          required: ["title", "executiveSummary", "endToEndProcess", "responsibilities", "risks", "recommendations", "nextSteps"],
          additionalProperties: false,
        },
      },
    } as any,
  });

  const rawContent = response.choices[0]?.message?.content;
  if (!rawContent) throw new Error("LLM returned empty response");
  const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);

  try {
    return JSON.parse(content) as DeloitteDocument;
  } catch {
    // Fallback: try to extract JSON from content
    const match = content.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as DeloitteDocument;
    throw new Error("Failed to parse LLM response as JSON");
  }
}

// ===================== Especificação Técnica =====================

export interface SpecDocument {
  title: string;
  markdown: string;
}

const SPEC_SYSTEM_PROMPT = `Você é um analista de sistemas sênior que transforma a transcrição de uma reunião técnica em uma ESPECIFICAÇÃO TÉCNICA detalhada de software (telas, integrações, APIs), no padrão usado em projetos corporativos.

Gere um documento profissional, denso e acionável para um desenvolvedor implementar, seguindo RIGOROSAMENTE esta estrutura em Markdown (use tabelas Markdown sempre que listar campos, componentes, status ou mapeamentos):

# <Título da Especificação>

## 1. Introdução
Contexto e o que o documento detalha.

## 2. Objetivo do Projeto
O objetivo de negócio e técnico.

## 3. Requisitos Funcionais e de Negócio
Lista de requisitos (visualização, atualização, travas sistêmicas, rastreabilidade, integrações).

## 4. Especificação da Interface (UI)
### 4.1. Layout Geral
Header, navegação, área de conteúdo.
### 4.2. Componentes
Tabela Markdown: | Componente | Descrição | Estilo/Comportamento |

## 5. Mapeamento de Campos e Integração de API
Tabela(s) Markdown: | Campo | Descrição | Origem/API | Observações |
Inclua endpoints, autenticação e fluxo de dados quando mencionados.

## 6. Considerações Técnicas para o Desenvolvedor
Performance, tratamento de erros, segurança, testes, flexibilidade.

## 7. Regras de Negócio
Travas e lógica (ex.: cálculo de status, dependências entre etapas).

## 8. Próximos Passos / Referências
Pendências, links e fontes citadas.

Regras:
- Extraia o máximo de detalhe concreto da transcrição (nomes de sistemas, campos, status, fluxos).
- Quando a transcrição não detalhar algo, faça suposições técnicas razoáveis e marque com "(a confirmar)".
- Use tabelas Markdown de verdade (com | e cabeçalho com ---).
- NÃO use blocos de código de diagrama (mermaid, graphviz, ASCII art). Descreva fluxos em texto, listas numeradas ou tabelas.
- Responda EXCLUSIVAMENTE com JSON puro (sem code fences) no formato:
{ "title": "...", "markdown": "<documento markdown completo começando com # título>" }`;

export async function generateSpecDocument(transcription: string): Promise<SpecDocument> {
  const userMessage = `Analise a transcrição de reunião abaixo e gere a ESPECIFICAÇÃO TÉCNICA completa em markdown, seguindo a estrutura definida:

---
${transcription}
---`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: SPEC_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "spec_document",
        strict: true,
        schema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Título da especificação" },
            markdown: { type: "string", description: "Documento completo em markdown" },
          },
          required: ["title", "markdown"],
          additionalProperties: false,
        },
      },
    } as any,
  });

  const rawContent = response.choices[0]?.message?.content;
  if (!rawContent) throw new Error("LLM returned empty response");
  const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);

  try {
    return JSON.parse(content) as SpecDocument;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as SpecDocument;
    throw new Error("Failed to parse LLM response as JSON");
  }
}

export function formatDocumentAsMarkdown(doc: DeloitteDocument): string {
  return `# ${doc.title}

---

## 1. Visão Executiva

${doc.executiveSummary}

---

## 2. Processo Ponta a Ponta

${doc.endToEndProcess}

---

## 3. Responsabilidades

${doc.responsibilities}

---

## 4. Riscos

${doc.risks}

---

## 5. Recomendações

${doc.recommendations}

---

## 6. Próximos Passos

${doc.nextSteps}

---

*Documento gerado automaticamente pela plataforma VideoDoc Consultivo — padrão Deloitte*
`;
}
