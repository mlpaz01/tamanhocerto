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
import { generateDeloitteDocument, formatDocumentAsMarkdown, generateSpecDocument } from "./documentGenerator";
import { generateDocx, generateSpecDocx } from "./docxGenerator";
import { storagePut, storageGet, storageGetSignedUrl, storagePath } from "./storage";

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
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const doc = await getDocumentById(input.id);
        if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
        if (doc.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });

        try {
          // Step 1: Determine audio source
          await updateDocument(input.id, { status: "transcribing" });

          let audioUrl: string;
          let isYoutube = false;

          if (doc.sourceType === "youtube" && doc.youtubeUrl) {
            // YouTube: yt-dlp baixa e extrai o áudio a partir da URL
            audioUrl = doc.youtubeUrl;
            isYoutube = true;
          } else if (doc.videoStorageKey) {
            // Upload: o arquivo já está no disco — passa o caminho local pro ffmpeg
            audioUrl = storagePath(doc.videoStorageKey);
          } else {
            throw new Error("Nenhuma fonte de vídeo disponível para transcrição.");
          }

          // Step 2: Transcribe audio
          const transcriptionResult = await transcribeAudio({
            audioUrl,
            isYoutube,
            language: "pt",
            prompt: "Transcrição de reunião de negócios em português brasileiro. Nomes de sistemas: PLM, RLM, WMS, SAP, ERP, Shopify.",
          });

          // Check for transcription error
          if ("error" in transcriptionResult) {
            const errDetail = (transcriptionResult as any).details ?? "";
            throw new Error(`Falha na transcrição: ${(transcriptionResult as any).error}. ${errDetail}`);
          }

          const transcription = (transcriptionResult as any).text ?? "";
          if (!transcription.trim()) {
            throw new Error("A transcrição retornou vazia. Verifique se o vídeo contém áudio.");
          }

          await updateDocument(input.id, { transcription, status: "analyzing" });

          // Step 3: Generate document via LLM (de acordo com o tipo escolhido)
          await updateDocument(input.id, { status: "generating" });

          let title: string;
          let markdownContent: string;
          let docxBuffer: Buffer;

          if (doc.docType === "spec") {
            const spec = await generateSpecDocument(transcription);
            title = spec.title;
            markdownContent = spec.markdown;
            docxBuffer = await generateSpecDocx(spec);
          } else {
            const deloitteDoc = await generateDeloitteDocument(transcription);
            title = deloitteDoc.title;
            markdownContent = formatDocumentAsMarkdown(deloitteDoc);
            docxBuffer = await generateDocx(deloitteDoc);
          }

          // Step 4: Save DOCX
          const docxKey = `documents/${ctx.user.id}/${input.id}/document.docx`;
          const { key: savedDocxKey } = await storagePut(docxKey, docxBuffer, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

          // Step 5: Save everything
          await updateDocument(input.id, {
            title,
            content: markdownContent,
            docxStorageKey: savedDocxKey,
            status: "done",
          });

          return { success: true, title };
        } catch (error: any) {
          await updateDocument(input.id, {
            status: "error",
            errorMessage: error?.message ?? "Erro desconhecido",
          });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error?.message ?? "Erro ao processar documento",
          });
        }
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
