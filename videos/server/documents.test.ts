import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock database helpers
vi.mock("./db", () => ({
  createDocument: vi.fn().mockResolvedValue(42),
  getDocumentById: vi.fn().mockResolvedValue({
    id: 42,
    userId: 1,
    title: "Test Document",
    status: "done",
    sourceType: "upload",
    videoStorageKey: "videos/1/test.mp4",
    youtubeUrl: null,
    transcription: "Test transcription",
    content: "## Visão Executiva\nTest content",
    docxStorageKey: "documents/1/42/document.docx",
    pdfStorageKey: null,
    fileSizeBytes: 1024,
    errorMessage: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  }),
  getDocumentsByUserId: vi.fn().mockResolvedValue([
    {
      id: 42,
      userId: 1,
      title: "Test Document",
      status: "done",
      sourceType: "upload",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    },
  ]),
  updateDocument: vi.fn().mockResolvedValue(undefined),
  getDb: vi.fn().mockResolvedValue(null),
  upsertUser: vi.fn(),
  getUserByOpenId: vi.fn(),
}));

vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ key: "test-key", url: "/manus-storage/test-key" }),
  storageGet: vi.fn().mockReturnValue("/manus-storage/test-key"),
  storageGetSignedUrl: vi.fn().mockResolvedValue("https://signed.url/test"),
}));

vi.mock("./_core/voiceTranscription", () => ({
  transcribeAudio: vi.fn().mockResolvedValue({ text: "Mock transcription text" }),
}));

vi.mock("./documentGenerator", () => ({
  generateDeloitteDocument: vi.fn().mockResolvedValue({
    title: "Mock Document Title",
    executiveSummary: "Executive summary content",
    endToEndProcess: "Process content",
    responsibilities: "Responsibilities content",
    risks: "Risks content",
    recommendations: "Recommendations content",
    nextSteps: "Next steps content",
  }),
  formatDocumentAsMarkdown: vi.fn().mockReturnValue("# Mock Document\n\n## Visão Executiva\nContent"),
}));

vi.mock("./docxGenerator", () => ({
  generateDocx: vi.fn().mockResolvedValue(Buffer.from("mock docx content")),
}));

function createAuthContext(userId = 1): TrpcContext {
  return {
    user: {
      id: userId,
      openId: "test-user",
      email: "test@example.com",
      name: "Test User",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("documents.createFromYoutube", () => {
  it("creates a document from a YouTube URL", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.documents.createFromYoutube({
      youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    expect(result).toHaveProperty("id");
    expect(typeof result.id).toBe("number");
  });
});

describe("documents.createFromUpload", () => {
  it("creates a document from an uploaded video", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.documents.createFromUpload({
      videoStorageKey: "videos/1/test.mp4",
      title: "Test Video",
      fileSizeBytes: 1024,
    });
    expect(result).toHaveProperty("id");
    expect(typeof result.id).toBe("number");
  });
});

describe("documents.getById", () => {
  it("returns a document owned by the user", async () => {
    const ctx = createAuthContext(1);
    const caller = appRouter.createCaller(ctx);
    const doc = await caller.documents.getById({ id: 42 });
    expect(doc.id).toBe(42);
    expect(doc.title).toBe("Test Document");
    expect(doc.status).toBe("done");
  });

  it("throws FORBIDDEN when document belongs to another user", async () => {
    const { getDocumentById } = await import("./db");
    vi.mocked(getDocumentById).mockResolvedValueOnce({
      id: 42,
      userId: 99, // different user
      title: "Other User Doc",
      status: "done",
      sourceType: "upload",
      videoStorageKey: null,
      youtubeUrl: null,
      transcription: null,
      content: null,
      docxStorageKey: null,
      pdfStorageKey: null,
      fileSizeBytes: null,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const ctx = createAuthContext(1);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.documents.getById({ id: 42 })).rejects.toThrow();
  });
});

describe("documents.list", () => {
  it("returns documents for the authenticated user", async () => {
    const ctx = createAuthContext(1);
    const caller = appRouter.createCaller(ctx);
    const docs = await caller.documents.list();
    expect(Array.isArray(docs)).toBe(true);
    expect(docs.length).toBeGreaterThan(0);
  });
});

describe("documents.getDocxUrl", () => {
  it("returns a signed URL for the DOCX file", async () => {
    const ctx = createAuthContext(1);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.documents.getDocxUrl({ id: 42 });
    expect(result).toHaveProperty("url");
    expect(typeof result.url).toBe("string");
  });
});
