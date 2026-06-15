import type { Express, Request, Response } from "express";
import { createReadStream } from "fs";
import { promises as fs } from "fs";
import path from "path";
import { storagePath } from "../storage";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req: Request, res: Response) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    let filePath: string;
    try {
      filePath = storagePath(key);
    } catch {
      res.status(400).send("Invalid storage key");
      return;
    }

    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        res.status(404).send("Not found");
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME[ext] ?? "application/octet-stream";
      res.set("Content-Type", mime);
      res.set("Content-Length", String(stat.size));
      res.set("Cache-Control", "private, max-age=3600");
      // Documentos viram download; mídia é servida inline.
      if (ext === ".docx" || ext === ".pdf") {
        res.set("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`);
      }
      createReadStream(filePath).pipe(res);
    } catch {
      res.status(404).send("Not found");
    }
  });
}
