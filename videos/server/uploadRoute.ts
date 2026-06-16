import express, { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import path from "path";
import { promises as fs } from "fs";
import crypto from "crypto";
import { sdk, type AuthenticatedUser } from "./_core/sdk";
import { ENV } from "./_core/env";

// Limite de upload. Vídeos grandes (gravações de tela) são gravados direto no disco
// (streaming), não na memória — evita estourar a RAM da VPS.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024; // 5GB

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const user = (req as any).appUser as AuthenticatedUser | undefined;
    if (!user) return cb(new Error("Unauthorized"), "");
    const dir = path.join(path.resolve(ENV.storageDir), "videos", String(user.id));
    fs.mkdir(dir, { recursive: true }).then(() => cb(null, dir)).catch(e => cb(e as Error, ""));
  },
  filename: (_req, file, cb) => {
    const ext = (file.originalname.split(".").pop() || "mp4").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "mp4";
    cb(null, `${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("video/")) cb(null, true);
    else cb(new Error("Apenas arquivos de vídeo são permitidos"));
  },
});

// Autentica ANTES do multer, para que o destino do disco já saiba o userId.
async function authFirst(req: Request, res: Response, next: NextFunction) {
  const user = await sdk.authenticateRequest(req).catch(() => null);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as any).appUser = user;
  next();
}

export function registerUploadRoute(app: express.Application) {
  const router = Router();

  router.post("/api/upload/video", authFirst, (req, res) => {
    upload.single("video")(req, res, async (err: any) => {
      if (err) {
        const tooBig = err?.code === "LIMIT_FILE_SIZE";
        res.status(tooBig ? 413 : 500).json({
          error: tooBig
            ? `Arquivo muito grande. Limite: ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024 * 1024))}GB. Considere comprimir o vídeo.`
            : (err?.message ?? "Upload falhou"),
        });
        return;
      }
      try {
        const user = (req as any).appUser as AuthenticatedUser;
        if (!req.file) {
          res.status(400).json({ error: "Nenhum arquivo enviado" });
          return;
        }
        const key = `videos/${user.id}/${req.file.filename}`;
        res.json({
          storageKey: key,
          url: `/manus-storage/${key}`,
          originalName: req.file.originalname,
          size: req.file.size,
          mimeType: req.file.mimetype,
        });
      } catch (e: any) {
        console.error("[Upload] Error:", e);
        res.status(500).json({ error: e?.message ?? "Upload falhou" });
      }
    });
  });

  app.use(router);
}
