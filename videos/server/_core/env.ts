// Configuração de ambiente — versão self-hosted (sem dependência da plataforma Manus/Forge).
export const ENV = {
  appId: process.env.VITE_APP_ID ?? "video-doc-engine",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  ownerEmail: (process.env.OWNER_EMAIL ?? "").toLowerCase(),
  isProduction: process.env.NODE_ENV === "production",

  // LLM via OpenRouter (API compatível com OpenAI)
  llmApiUrl: process.env.LLM_API_URL ?? "https://openrouter.ai/api/v1",
  llmApiKey: process.env.OPENROUTER_API_KEY ?? "",
  llmModel: process.env.LLM_MODEL ?? "google/gemini-2.5-flash",

  // Storage local em disco
  storageDir: process.env.STORAGE_DIR ?? "./data/storage",
  // URL pública do site (usada em links/redirects)
  publicUrl: process.env.PUBLIC_URL ?? "",

  // Transcrição: "groq" (API gratuita, recomendado p/ nuvem) ou "local" (Whisper no servidor)
  transcribeProvider: (process.env.TRANSCRIBE_PROVIDER ?? "groq").toLowerCase(),

  // Groq (Whisper hospedado, compatível com OpenAI)
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  groqApiUrl: process.env.GROQ_API_URL ?? "https://api.groq.com/openai/v1",
  groqModel: process.env.GROQ_MODEL ?? "whisper-large-v3-turbo",

  // Transcrição local (Whisper) — usado quando TRANSCRIBE_PROVIDER=local
  whisperPython: process.env.WHISPER_PYTHON ?? "python3",
  whisperScript: process.env.WHISPER_SCRIPT ?? "./scripts/transcribe.py",
  whisperModel: process.env.WHISPER_MODEL ?? "small",

  // Ferramentas de áudio (necessárias em ambos os modos)
  ytDlpPath: process.env.YTDLP_PATH ?? "yt-dlp",
  ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg",

  // Conversão DOCX -> PDF (LibreOffice headless)
  libreofficePath: process.env.LIBREOFFICE_PATH ?? "soffice",
};
