import { z } from "zod";
import { nanoid } from "nanoid";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { sdk, hashPassword, verifyPassword } from "./_core/sdk";
import { ENV } from "./_core/env";
import {
  createDocument,
  getDocumentById,
  getDocumentsByUserId,
  updateDocument,
  getUserByEmail,
  createUser,
} from "./db";
import { transcribeAudio } from "./_core/voiceTranscription";
import { extractKeyFrames } from "./_core/frameExtractor";
import { downloadYoutubeVideo } from "./_core/youtube";
import { classifyFrames, galleryMarkdown, buildSpecWebMarkdown, type ClassifiedFrame } from "./_core/frameClassifier";
import { extractParticipants, type ParticipantsResult } from "./_core/participantExtractor";
import { generateDeloitteDocument, formatDocumentAsMarkdown, generateSpecDocument } from "./documentGenerator";
import { generateDocx, generateSpecDocx } from "./docxGenerator";
import { docxBufferToPdf } from "./pdfGenerator";
import { storagePut, storageGet, storageGetSignedUrl, storagePath } from "./storage";
import type { Document } from "../drizzle/schema";

// Processa um documento em BACKGROUND (transcrição → capturas → geração → DOCX),
// atualizando o status no banco a cada etapa. A tela acompanha por polling de getById.
// Roda fora do ciclo da requisição HTTP, então vídeos longos não dependem de uma
// conexão aberta por 20+ minutos.
async function runDocumentPipeline(doc: Document, userId: number, includeScreenshots: boolean): Promise<void> {
  try {
    await updateDocument(doc.id, { status: "transcribing" });

    let audioUrl: string;
    let isYoutube = false;
    let localVideoKey: string | null = doc.videoStorageKey ?? null;

    if (doc.sourceType === "youtube" && doc.youtubeUrl) {
      if (includeScreenshots) {
        // Baixa o VÍDEO do YouTube pro storage → habilita transcrição + capturas de tela.
        const key = `videos/${userId}/yt_${doc.id}.mp4`;
        await downloadYoutubeVideo(doc.youtubeUrl, storagePath(key));
        await updateDocument(doc.id, { videoStorageKey: key });
        localVideoKey = key;
        audioUrl = storagePath(key);
        isYoutube = false; // agora é um arquivo local
      } else {
        audioUrl = doc.youtubeUrl;
        isYoutube = true;
      }
    } else if (doc.videoStorageKey) {
      audioUrl = storagePath(doc.videoStorageKey);
    } else {
      throw new Error("Nenhuma fonte de vídeo disponível para transcrição.");
    }

    const transcriptionResult = await transcribeAudio({
      audioUrl,
      isYoutube,
      language: "pt",
      prompt: "Transcrição de reunião de negócios em português brasileiro. Nomes de sistemas: PLM, RLM, WMS, SAP, ERP, Shopify.",
    });
    if ("error" in transcriptionResult) {
      const errDetail = (transcriptionResult as any).details ?? "";
      throw new Error(`Falha na transcrição: ${(transcriptionResult as any).error}. ${errDetail}`);
    }
    const transcription = (transcriptionResult as any).text ?? "";
    if (!transcription.trim()) {
      throw new Error("A transcrição retornou vazia. Verifique se o vídeo contém áudio.");
    }
    await updateDocument(doc.id, { transcription, status: "analyzing" });

    // Capturas de tela + participantes (só para vídeo enviado; ambos best-effort e independentes —
    // cada um no seu try/catch para uma feature opcional nunca derrubar o documento inteiro).
    let classified: ClassifiedFrame[] = [];
    let participants: ParticipantsResult | null = null;
    const urlByIndex = new Map<number, string>();

    if (includeScreenshots && localVideoKey) {
      const localVideo = storagePath(localVideoKey);

      // Extrai (mais frames, já que alguns serão descartados) e classifica: descarta câmera/
      // galeria, mantém telas, com legenda factual. Em falha, classifyFrames degrada p/ "mantém
      // tudo" — nunca lança.
      try {
        const frames = await extractKeyFrames(localVideo, 16);
        classified = await classifyFrames(frames);
      } catch (e) {
        console.warn("[Screenshots] extração/classificação falhou:", e);
      }

      // Upload eager de TODAS as capturas mantidas (barato — disco local); a decisão de quais vão
      // inline vs. galeria vem depois, via resolveScreenshotTokens.
      for (const f of classified) {
        if (!f.keep) continue;
        try {
          const { key } = await storagePut(`documents/${userId}/${doc.id}/shot_${f.index + 1}.jpg`, f.buffer, "image/jpeg");
          urlByIndex.set(f.index, await storageGetSignedUrl(key));
        } catch (e) {
          console.warn(`[Screenshots] upload do frame ${f.index} falhou:`, e);
        }
      }

      // Participantes — independente das capturas; falha retorna lista vazia, não lança.
      try {
        participants = await extractParticipants(localVideo);
      } catch (e) {
        console.warn("[Participants] extração falhou:", e);
      }
    }

    await updateDocument(doc.id, { status: "generating" });

    const keptFrames = classified.filter(f => f.keep);

    let title: string;
    let markdownContent: string;
    let docxBuffer: Buffer;
    if (doc.docType === "spec") {
      const spec = await generateSpecDocument(transcription, keptFrames);
      title = spec.title;
      markdownContent = buildSpecWebMarkdown(spec.markdown, keptFrames, urlByIndex);
      docxBuffer = await generateSpecDocx(spec, keptFrames, participants);
    } else {
      const deloitteDoc = await generateDeloitteDocument(transcription);
      title = deloitteDoc.title;
      // Deloitte não usa marcadores inline: capturas (já filtradas) na galeria no fim.
      markdownContent = formatDocumentAsMarkdown(deloitteDoc) + galleryMarkdown(keptFrames, urlByIndex);
      docxBuffer = await generateDocx(deloitteDoc, keptFrames, participants);
    }

    const docxKey = `documents/${userId}/${doc.id}/document.docx`;
    const { key: savedDocxKey } = await storagePut(docxKey, docxBuffer, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

    // PDF (best-effort: se o LibreOffice falhar, não derruba o documento)
    let pdfStorageKey: string | undefined;
    try {
      const pdfBuffer = await docxBufferToPdf(docxBuffer);
      const r = await storagePut(`documents/${userId}/${doc.id}/document.pdf`, pdfBuffer, "application/pdf");
      pdfStorageKey = r.key;
    } catch (e) {
      console.warn(`[PDF] conversão falhou para doc ${doc.id}:`, e);
    }

    await updateDocument(doc.id, {
      title,
      content: markdownContent,
      docxStorageKey: savedDocxKey,
      ...(pdfStorageKey ? { pdfStorageKey } : {}),
      status: "done",
    });

    // Participantes: gravação SEPARADA e best-effort. Se a coluna `participants` ainda não existir
    // no banco (ex.: deploy que reiniciou antes do ALTER TABLE), não queremos perder o documento
    // já concluído — apenas logamos e seguimos.
    if (participants && participants.names.length) {
      try {
        await updateDocument(doc.id, { participants: JSON.stringify(participants) });
      } catch (e: any) {
        console.warn(`[Participants] não gravou participantes do doc ${doc.id} (coluna ausente?):`, e?.message ?? e);
      }
    }
    console.log(`[Pipeline] doc ${doc.id} concluído: ${title} (pdf=${pdfStorageKey ? "ok" : "nao"})`);
  } catch (error: any) {
    console.error(`[Pipeline] doc ${doc.id} falhou:`, error?.message ?? error);
    await updateDocument(doc.id, { status: "error", errorMessage: error?.message ?? "Erro desconhecido" }).catch(() => {});
  }
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),

    register: publicProcedure
      .input(z.object({
        name: z.string().min(1).max(120),
        email: z.string().email(),
        password: z.string().min(8).max(200),
      }))
      .mutation(async ({ ctx, input }) => {
        const email = input.email.toLowerCase().trim();
        const existing = await getUserByEmail(email);
        if (existing) {
          throw new TRPCError({ code: "CONFLICT", message: "E-mail já cadastrado." });
        }
        const openId = `local_${nanoid(16)}`;
        const passwordHash = await hashPassword(input.password);
        const role = ENV.ownerEmail && email === ENV.ownerEmail ? "admin" : "user";
        await createUser({
          openId,
          name: input.name,
          email,
          passwordHash,
          loginMethod: "password",
          role,
          lastSignedIn: new Date(),
        });

        const token = await sdk.createSessionToken(openId, { name: input.name, expiresInMs: ONE_YEAR_MS });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        return { success: true } as const;
      }),

    login: publicProcedure
      .input(z.object({
        email: z.string().email(),
        password: z.string().min(1),
      }))
      .mutation(async ({ ctx, input }) => {
        const email = input.email.toLowerCase().trim();
        const user = await getUserByEmail(email);
        if (!user || !user.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "E-mail ou senha inválidos." });
        }
        const token = await sdk.createSessionToken(user.openId, { name: user.name ?? "", expiresInMs: ONE_YEAR_MS });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        return { success: true } as const;
      }),

    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  documents: router({
    // Create a new document job (YouTube URL)
    createFromYoutube: protectedProcedure
      .input(z.object({ youtubeUrl: z.string().url(), docType: z.enum(["deloitte", "spec"]).optional() }))
      .mutation(async ({ ctx, input }) => {
        const docId = await createDocument({
          userId: ctx.user.id,
          title: "Processando...",
          sourceType: "youtube",
          youtubeUrl: input.youtubeUrl,
          docType: input.docType ?? "deloitte",
          status: "pending",
        });
        return { id: docId };
      }),

    // Create a new document job from uploaded MP4 (after upload)
    createFromUpload: protectedProcedure
      .input(z.object({
        videoStorageKey: z.string(),
        title: z.string().optional(),
        fileSizeBytes: z.number().optional(),
        docType: z.enum(["deloitte", "spec"]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const docId = await createDocument({
          userId: ctx.user.id,
          title: input.title ?? "Vídeo enviado",
          sourceType: "upload",
          docType: input.docType ?? "deloitte",
          videoStorageKey: input.videoStorageKey,
          fileSizeBytes: input.fileSizeBytes,
          status: "transcribing",
        });
        return { id: docId };
      }),

    // Get document by ID (with ownership check)
    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const doc = await getDocumentById(input.id);
        if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
        if (doc.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
        return doc;
      }),

    // List user's documents
    list: protectedProcedure.query(async ({ ctx }) => {
      return getDocumentsByUserId(ctx.user.id);
    }),

    // Process: transcribe + generate document
    process: protectedProcedure
      .input(z.object({ id: z.number(), includeScreenshots: z.boolean().optional() }))
      .mutation(async ({ ctx, input }) => {
        const doc = await getDocumentById(input.id);
        if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
        if (doc.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });

        // Dispara o processamento em BACKGROUND e retorna na hora.
        // A tela acompanha o progresso via documents.getById (polling).
        void runDocumentPipeline(doc, ctx.user.id, input.includeScreenshots ?? false);
        return { started: true } as const;
      }),

    // Get download URL for DOCX
    getDocxUrl: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const doc = await getDocumentById(input.id);
        if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
        if (doc.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
        if (!doc.docxStorageKey) throw new TRPCError({ code: "NOT_FOUND", message: "DOCX não gerado ainda" });
        const url = await storageGetSignedUrl(doc.docxStorageKey);
        return { url };
      }),

    // Get download URL for PDF
    getPdfUrl: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const doc = await getDocumentById(input.id);
        if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
        if (doc.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
        if (!doc.pdfStorageKey) throw new TRPCError({ code: "NOT_FOUND", message: "PDF não gerado ainda" });
        const url = await storageGetSignedUrl(doc.pdfStorageKey);
        return { url };
      }),

    // Delete document
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const doc = await getDocumentById(input.id);
        if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
        if (doc.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
        const { getDb } = await import("./db");
        const { documents } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();
        if (db) await db.delete(documents).where(eq(documents.id, input.id));
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
