import { useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Upload as UploadIcon, Youtube, FileVideo, X, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { toast } from "sonner";
import { ProcessingSteps, type ProcessingStatus } from "@/components/ProcessingSteps";

type UploadMode = "file" | "youtube";

export default function UploadPage() {
  const [, navigate] = useLocation();
  const { user, isAuthenticated } = useAuth();
  const [mode, setMode] = useState<UploadMode>("file");
  const [docType, setDocType] = useState<"deloitte" | "spec">("deloitte");
  const [includeScreenshots, setIncludeScreenshots] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>("pending");
  const [lastActiveStatus, setLastActiveStatus] = useState<ProcessingStatus>("pending");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [docId, setDocId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const createFromYoutube = trpc.documents.createFromYoutube.useMutation();
  const createFromUpload = trpc.documents.createFromUpload.useMutation();
  const processDoc = trpc.documents.process.useMutation();

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("video/")) {
      setSelectedFile(file);
    } else {
      toast.error("Por favor, envie apenas arquivos de vídeo.");
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSelectedFile(file);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isValidYoutubeUrl = (url: string) => {
    return /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+/.test(url);
  };

  const handleSubmit = async () => {
    if (!isAuthenticated) {
      window.location.href = getLoginUrl();
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      let newDocId: number;

      if (mode === "youtube") {
        if (!isValidYoutubeUrl(youtubeUrl)) {
          toast.error("URL do YouTube inválida.");
          setIsProcessing(false);
          return;
        }
        setProcessingStatus("uploading");
        setLastActiveStatus("uploading");
        const result = await createFromYoutube.mutateAsync({ youtubeUrl, docType });
        newDocId = result.id;
        setDocId(newDocId);
      } else {
        if (!selectedFile) {
          toast.error("Selecione um arquivo de vídeo.");
          setIsProcessing(false);
          return;
        }

        setProcessingStatus("uploading");
        setLastActiveStatus("uploading");

        // Upload file
        const formData = new FormData();
        formData.append("video", selectedFile);

        const uploadRes = await fetch(`${import.meta.env.BASE_URL}api/upload/video`, {
          method: "POST",
          body: formData,
          credentials: "include",
        });

        if (!uploadRes.ok) {
          const err = await uploadRes.json().catch(() => ({ error: "Upload falhou" }));
          throw new Error(err.error ?? "Upload falhou");
        }

        const uploadData = await uploadRes.json();
        setProcessingStatus("transcribing");
        setLastActiveStatus("transcribing");

        const result = await createFromUpload.mutateAsync({
          videoStorageKey: uploadData.storageKey,
          title: selectedFile.name.replace(/\.[^.]+$/, ""),
          fileSizeBytes: selectedFile.size,
          docType,
        });
        newDocId = result.id;
        setDocId(newDocId);
      }

      // Process the document
      setProcessingStatus("transcribing");
      setLastActiveStatus("transcribing");
      await processDoc.mutateAsync({ id: newDocId, includeScreenshots: mode === "file" ? includeScreenshots : false });
      setProcessingStatus("done");

      setTimeout(() => {
        navigate(`/document/${newDocId}`);
      }, 1500);
    } catch (err: any) {
      setLastActiveStatus(processingStatus);
      setProcessingStatus("error");
      const msg = err?.message ?? "Erro ao processar o vídeo.";
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      if (processingStatus !== "done") {
        setIsProcessing(false);
      }
    }
  };

  const canSubmit = mode === "youtube" ? isValidYoutubeUrl(youtubeUrl) : !!selectedFile;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container py-4 flex items-center justify-between">
          <button onClick={() => navigate("/")} className="flex items-center gap-2 group">
            <div className="w-8 h-8 bg-primary rounded flex items-center justify-center">
              <FileVideo className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-foreground text-sm">VideoDoc</span>
          </button>
          {isAuthenticated && (
            <button
              onClick={() => navigate("/history")}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Histórico
            </button>
          )}
        </div>
      </div>

      <div className="container py-12 max-w-2xl">
        {/* Title */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-foreground mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>
            Novo Documento
          </h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Envie um vídeo MP4 ou cole um link do YouTube para gerar documentação consultiva no padrão Deloitte automaticamente.
          </p>
        </div>

        {/* Document type selector */}
        {!isProcessing && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            <button
              onClick={() => setDocType("deloitte")}
              className={cn(
                "text-left p-4 rounded-xl border-2 transition-all duration-200",
                docType === "deloitte" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
              )}
            >
              <p className="font-semibold text-sm text-foreground">Relatório Consultivo</p>
              <p className="text-xs text-muted-foreground mt-1">Padrão Deloitte: visão executiva, riscos, recomendações e próximos passos.</p>
            </button>
            <button
              onClick={() => setDocType("spec")}
              className={cn(
                "text-left p-4 rounded-xl border-2 transition-all duration-200",
                docType === "spec" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
              )}
            >
              <p className="font-semibold text-sm text-foreground">Especificação Técnica</p>
              <p className="text-xs text-muted-foreground mt-1">Requisitos, UI, mapeamento de campos/APIs e regras de negócio para o desenvolvedor.</p>
            </button>
          </div>
        )}

        {/* Mode selector */}
        <div className="flex gap-2 mb-6 p-1 bg-muted rounded-lg w-fit">
          <button
            onClick={() => setMode("file")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200",
              mode === "file" ? "bg-white text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <UploadIcon className="w-4 h-4" />
            Arquivo MP4
          </button>
          <button
            onClick={() => setMode("youtube")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200",
              mode === "youtube" ? "bg-white text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Youtube className="w-4 h-4" />
            Link YouTube
          </button>
        </div>

        {/* Upload area */}
        {!isProcessing && (
          <div className="mb-6">
            {mode === "file" ? (
              <div>
                {!selectedFile ? (
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      "border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all duration-200",
                      isDragging ? "drop-zone-active" : "border-border hover:border-primary/50 hover:bg-primary/2"
                    )}
                  >
                    <div className="flex flex-col items-center gap-4">
                      <div className={cn(
                        "w-16 h-16 rounded-full flex items-center justify-center transition-colors duration-200",
                        isDragging ? "bg-primary/10" : "bg-muted"
                      )}>
                        <UploadIcon className={cn("w-7 h-7", isDragging ? "text-primary" : "text-muted-foreground")} />
                      </div>
                      <div>
                        <p className="font-semibold text-foreground mb-1">
                          {isDragging ? "Solte o arquivo aqui" : "Arraste e solte seu vídeo"}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          ou <span className="text-primary font-medium">clique para selecionar</span>
                        </p>
                        <p className="text-xs text-muted-foreground mt-2">MP4, MOV, AVI — até 500MB</p>
                      </div>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={handleFileSelect}
                    />
                  </div>
                ) : (
                  <div className="border border-border rounded-xl p-4 flex items-center gap-4 bg-white">
                    <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center shrink-0">
                      <FileVideo className="w-6 h-6 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-foreground truncate">{selectedFile.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{formatFileSize(selectedFile.size)}</p>
                    </div>
                    <button
                      onClick={() => setSelectedFile(null)}
                      className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center transition-colors"
                    >
                      <X className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="relative">
                  <Youtube className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="url"
                    placeholder="https://www.youtube.com/watch?v=..."
                    value={youtubeUrl}
                    onChange={e => setYoutubeUrl(e.target.value)}
                    className="pl-10 h-12 text-sm"
                  />
                </div>
                {youtubeUrl && !isValidYoutubeUrl(youtubeUrl) && (
                  <p className="text-xs text-destructive">URL do YouTube inválida.</p>
                )}
                {youtubeUrl && isValidYoutubeUrl(youtubeUrl) && (
                  <p className="text-xs text-accent font-medium">URL válida detectada.</p>
                )}
              </div>
            )}

            {mode === "file" && (
              <label className="flex items-center gap-2 mt-4 text-sm text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeScreenshots}
                  onChange={e => setIncludeScreenshots(e.target.checked)}
                  className="w-4 h-4 accent-primary"
                />
                Incluir capturas de tela do vídeo no documento
              </label>
            )}
          </div>
        )}

        {/* Processing steps */}
        {isProcessing && (
          <div className="mb-8 p-6 bg-white border border-border rounded-xl">
            <h3 className="text-sm font-semibold text-foreground mb-6">Processando seu vídeo...</h3>
            <ProcessingSteps status={processingStatus} lastActiveStatus={lastActiveStatus} errorMessage={errorMessage} />
          </div>
        )}

        {/* Submit button */}
        {!isProcessing && (
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full h-12 text-sm font-semibold gap-2"
            size="lg"
          >
            {!isAuthenticated ? (
              <>Entrar para continuar</>
            ) : (
              <>
                Gerar Documentação
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>
        )}

        {isProcessing && processingStatus !== "done" && processingStatus !== "error" && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground mt-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Isso pode levar alguns minutos...</span>
          </div>
        )}

        {processingStatus === "error" && (
          <Button
            onClick={() => {
              setIsProcessing(false);
              setProcessingStatus("pending");
              setLastActiveStatus("pending");
              setErrorMessage(null);
            }}
            variant="outline"
            className="w-full h-12 mt-4"
          >
            Tentar novamente
          </Button>
        )}
      </div>
    </div>
  );
}
