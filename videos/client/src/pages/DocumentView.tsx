import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import {
  ArrowLeft, Download, FileText, Clock, CheckCircle2,
  Loader2, AlertCircle, RefreshCw, ChevronRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ProcessingSteps, type ProcessingStatus } from "@/components/ProcessingSteps";
import { Streamdown } from "streamdown";

const SECTIONS = [
  { key: "executiveSummary", label: "Visão Executiva", number: "1" },
  { key: "endToEndProcess", label: "Processo Ponta a Ponta", number: "2" },
  { key: "responsibilities", label: "Responsabilidades", number: "3" },
  { key: "risks", label: "Riscos", number: "4" },
  { key: "recommendations", label: "Recomendações", number: "5" },
  { key: "nextSteps", label: "Próximos Passos", number: "6" },
];

function extractSection(content: string, sectionTitle: string): string {
  const lines = content.split("\n");
  let capturing = false;
  const result: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ") && line.toLowerCase().includes(sectionTitle.toLowerCase())) {
      capturing = true;
      continue;
    }
    if (capturing && line.startsWith("## ")) break;
    if (capturing) result.push(line);
  }

  return result.join("\n").trim();
}

export default function DocumentView() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const docId = parseInt(params.id ?? "0");
  const [activeSection, setActiveSection] = useState("1");
  const [isDownloading, setIsDownloading] = useState(false);
  const [pollInterval, setPollInterval] = useState<number | null>(3000);

  const { data: doc, refetch, isLoading } = trpc.documents.getById.useQuery(
    { id: docId },
    {
      enabled: !!docId,
      refetchInterval: pollInterval ?? undefined,
    }
  );

  // Stop polling when done or error
  useEffect(() => {
    if (doc?.status === "done" || doc?.status === "error") {
      setPollInterval(null);
    }
  }, [doc?.status]);

  const docxUrlQuery = trpc.documents.getDocxUrl.useQuery(
    { id: docId },
    { enabled: doc?.status === "done" && !!doc?.docxStorageKey }
  );

  const pdfUrlQuery = trpc.documents.getPdfUrl.useQuery(
    { id: docId },
    { enabled: doc?.status === "done" && !!doc?.pdfStorageKey, retry: false }
  );

  const handleDownloadDocx = async () => {
    if (!docxUrlQuery.data?.url) {
      toast.error("DOCX não disponível ainda.");
      return;
    }
    setIsDownloading(true);
    try {
      const a = document.createElement("a");
      a.href = docxUrlQuery.data.url;
      a.download = `${doc?.title ?? "documento"}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      toast.error("Erro ao baixar o arquivo.");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDownloadPdf = () => {
    if (!pdfUrlQuery.data?.url) {
      toast.error("PDF não disponível para este documento.");
      return;
    }
    const a = document.createElement("a");
    a.href = pdfUrlQuery.data.url;
    a.download = `${doc?.title ?? "documento"}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Carregando documento...</p>
        </div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-foreground font-medium">Documento não encontrado.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/")}>Voltar</Button>
        </div>
      </div>
    );
  }

  const isProcessing = !["done", "error"].includes(doc.status);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => navigate("/history")}
              className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center transition-colors shrink-0"
            >
              <ArrowLeft className="w-4 h-4 text-muted-foreground" />
            </button>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-foreground truncate">
                {doc.title === "Processando..." ? "Gerando documento..." : doc.title}
              </h1>
              <p className="text-xs text-muted-foreground">
                {new Date(doc.createdAt).toLocaleDateString("pt-BR", {
                  day: "2-digit", month: "short", year: "numeric"
                })}
              </p>
            </div>
          </div>

          {doc.status === "done" && (
            <div className="flex items-center gap-2 shrink-0">
              {doc.pdfStorageKey && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadPdf}
                  disabled={!pdfUrlQuery.data?.url}
                  className="gap-1.5 text-xs h-8"
                >
                  <Download className="w-3.5 h-3.5" />
                  PDF
                </Button>
              )}
              <Button
                size="sm"
                onClick={handleDownloadDocx}
                disabled={isDownloading || !docxUrlQuery.data?.url}
                className="gap-1.5 text-xs h-8"
              >
                {isDownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                DOCX
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Processing state */}
      {isProcessing && (
        <div className="container py-12 max-w-2xl">
          <div className="bg-white border border-border rounded-xl p-8">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <FileText className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="font-semibold text-foreground text-sm">Processando vídeo</h2>
                <p className="text-xs text-muted-foreground">Isso pode levar alguns minutos</p>
              </div>
            </div>
            <ProcessingSteps
              status={doc.status as ProcessingStatus}
              errorMessage={doc.errorMessage ?? undefined}
            />
          </div>
        </div>
      )}

      {/* Error state */}
      {doc.status === "error" && (
        <div className="container py-12 max-w-2xl">
          <div className="bg-white border border-destructive/20 rounded-xl p-8 text-center">
            <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <h2 className="font-semibold text-foreground mb-2">Erro no processamento</h2>
            <p className="text-sm text-muted-foreground mb-6">{doc.errorMessage ?? "Ocorreu um erro inesperado."}</p>
            <Button onClick={() => navigate("/upload")} className="gap-2">
              <RefreshCw className="w-4 h-4" />
              Tentar novamente
            </Button>
          </div>
        </div>
      )}

      {/* Document content */}
      {doc.status === "done" && doc.content && (
        <div className="container py-8">
          <div className="flex gap-8">
            {/* Sidebar navigation */}
            <aside className="hidden lg:block w-56 shrink-0">
              <div className="sticky top-20">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Seções</p>
                <nav className="space-y-1">
                  {SECTIONS.map(section => (
                    <button
                      key={section.number}
                      onClick={() => setActiveSection(section.number)}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all duration-150 text-left",
                        activeSection === section.number
                          ? "bg-primary text-white font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                    >
                      <span className={cn(
                        "w-5 h-5 rounded text-xs flex items-center justify-center font-bold shrink-0",
                        activeSection === section.number ? "bg-white/20" : "bg-muted"
                      )}>
                        {section.number}
                      </span>
                      <span className="truncate">{section.label}</span>
                    </button>
                  ))}
                </nav>

                {/* Document info */}
                <div className="mt-6 pt-6 border-t border-border space-y-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="w-3.5 h-3.5 text-accent" />
                    <span>Padrão Deloitte</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{new Date(doc.createdAt).toLocaleDateString("pt-BR")}</span>
                  </div>
                  {doc.sourceType && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <FileText className="w-3.5 h-3.5" />
                      <span>{doc.sourceType === "youtube" ? "YouTube" : "MP4"}</span>
                    </div>
                  )}
                </div>
              </div>
            </aside>

            {/* Main content */}
            <main className="flex-1 min-w-0">
              {/* Mobile section tabs */}
              <div className="lg:hidden mb-6 overflow-x-auto">
                <div className="flex gap-2 pb-2">
                  {SECTIONS.map(section => (
                    <button
                      key={section.number}
                      onClick={() => setActiveSection(section.number)}
                      className={cn(
                        "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                        activeSection === section.number
                          ? "bg-primary text-white"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {section.number}. {section.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Document header */}
              <div className="bg-white border border-border rounded-xl p-8 mb-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center shrink-0">
                    <FileText className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold text-foreground mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>
                      {doc.title}
                    </h1>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-accent" />
                        Documentação Consultiva
                      </span>
                      <span>•</span>
                      <span>Padrão Deloitte</span>
                      <span>•</span>
                      <span>{new Date(doc.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Active section content */}
              {SECTIONS.map(section => {
                if (section.number !== activeSection) return null;
                const sectionContent = extractSection(doc.content!, section.label);

                return (
                  <div key={section.key} className="bg-white border border-border rounded-xl p-8">
                    <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border">
                      <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                        <span className="text-white text-xs font-bold">{section.number}</span>
                      </div>
                      <h2 className="text-lg font-bold text-primary" style={{ fontFamily: "'Playfair Display', serif" }}>
                        {section.label}
                      </h2>
                    </div>
                    <div className="document-content">
                      <Streamdown>{sectionContent || doc.content!}</Streamdown>
                    </div>

                    {/* Next section button */}
                    {parseInt(activeSection) < SECTIONS.length && (
                      <div className="mt-8 pt-6 border-t border-border flex justify-end">
                        <button
                          onClick={() => setActiveSection(String(parseInt(activeSection) + 1))}
                          className="flex items-center gap-2 text-sm text-primary font-medium hover:gap-3 transition-all duration-150"
                        >
                          Próxima seção
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </main>
          </div>
        </div>
      )}
    </div>
  );
}
