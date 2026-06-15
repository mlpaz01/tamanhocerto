import express, { Router } from "express";
import multer from "multer";
import { sdk } from "./_core/sdk";
import { storagePut } from "./storage";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Only video files are allowed"));
    }
  },
});

export function registerUploadRoute(app: express.Application) {
  const router = Router();

  router.post("/api/upload/video", upload.single("video"), async (req, res) => {
    try {
      // Auth check via SDK
      const user = await sdk.authenticateRequest(req).catch(() => null);
      if (!user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      const file = req.file;
      const ext = file.originalname.split(".").pop() ?? "mp4";
      const key = `videos/${user.id}/${Date.now()}.${ext}`;

      const { key: storageKey, url } = await storagePut(key, file.buffer, file.mimetype);

      res.json({
        storageKey,
        url,
        originalName: file.originalname,
        size: file.size,
        mimeType: file.mimetype,
      });
    } catch (err: any) {
      console.error("[Upload] Error:", err);
      res.status(500).json({ error: err?.message ?? "Upload failed" });
    }
  });

  app.use(router);
}
