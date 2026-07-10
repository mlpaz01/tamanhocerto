import { describe, expect, it } from "vitest";
import { resolveScreenshotTokens, matchCanonicalToken, type ClassifiedFrame } from "./_core/frameClassifier";

// Frames "keep" fake — só precisamos do index; buffer/caption não importam para a função pura.
const kept = (indices: number[]): ClassifiedFrame[] =>
  indices.map(i => ({ buffer: Buffer.alloc(0), caption: `cap${i}`, index: i, keep: true, stageHint: "" }));

describe("resolveScreenshotTokens", () => {
  it("normaliza um marcador válido para linha canônica isolada e o marca como usado", () => {
    const { markdown, usedIndices } = resolveScreenshotTokens("Texto {{SCREENSHOT:2}} fim", kept([2]));
    expect(markdown).toContain("\n\n{{SCREENSHOT:2}}\n\n");
    expect([...usedIndices]).toEqual([2]);
  });

  it("casa marcador no meio da frase (não só linha isolada)", () => {
    const { usedIndices } = resolveScreenshotTokens("veja abaixo: {{SCREENSHOT:0}}.", kept([0]));
    expect([...usedIndices]).toEqual([0]);
  });

  it("tolera espaços e caixa dentro do marcador", () => {
    const { usedIndices } = resolveScreenshotTokens("x {{ screenshot : 3 }} y", kept([3]));
    expect([...usedIndices]).toEqual([3]);
  });

  it("deduplica: mesmo índice repetido mantém só a 1ª ocorrência", () => {
    const { markdown, usedIndices } = resolveScreenshotTokens("{{SCREENSHOT:1}} meio {{SCREENSHOT:1}}", kept([1]));
    expect((markdown.match(/\{\{SCREENSHOT:1\}\}/g) ?? []).length).toBe(1);
    expect([...usedIndices]).toEqual([1]);
  });

  it("ignora índice alucinado (não existe entre os keep)", () => {
    const { markdown, usedIndices } = resolveScreenshotTokens("a {{SCREENSHOT:9}} b", kept([0, 1]));
    expect(markdown).not.toContain("SCREENSHOT");
    expect(usedIndices.size).toBe(0);
  });

  it("ignora índice de frame descartado (keep=false não está na lista)", () => {
    // keep([0]) só inclui o índice 0 como válido; o marcador 5 (descartado) é removido
    const { usedIndices } = resolveScreenshotTokens("{{SCREENSHOT:5}}", kept([0]));
    expect(usedIndices.size).toBe(0);
  });

  it("preserva o texto ao redor ao remover marcador inválido", () => {
    const { markdown } = resolveScreenshotTokens("antes {{SCREENSHOT:9}} depois", kept([0]));
    expect(markdown).toContain("antes");
    expect(markdown).toContain("depois");
  });

  it("lida com múltiplos marcadores válidos distintos, em ordem", () => {
    const { usedIndices } = resolveScreenshotTokens("{{SCREENSHOT:0}} ... {{SCREENSHOT:2}}", kept([0, 1, 2]));
    expect([...usedIndices]).toEqual([0, 2]);
  });
});

describe("matchCanonicalToken", () => {
  it("reconhece linha canônica isolada", () => {
    expect(matchCanonicalToken("{{SCREENSHOT:4}}")).toBe(4);
    expect(matchCanonicalToken("  {{SCREENSHOT:4}}  ")).toBe(4);
  });
  it("rejeita linha com texto além do marcador", () => {
    expect(matchCanonicalToken("veja {{SCREENSHOT:4}}")).toBeNull();
    expect(matchCanonicalToken("texto normal")).toBeNull();
  });
});
