import { useLocation } from "wouter";
import {
  FileText, Clock, CheckCircle2, AlertCircle, Loader2,
  Plus, Trash2, Youtube, Upload, ArrowRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const STATUS_CONFIG = {
  pending: { label: "Aguardando", color: "text-muted-foreground", bg: "bg-muted", icon: Clock },
  uploading: { label: "Enviando", color: "text-info", bg: "bg-info/10", icon: Loader2 },
  transcribing: { label: "Transcrevendo", color: "text-warning", bg: "bg-warning/10", icon: Loader2 },
  analyzing: { label: "Analisando", color: "text-info", bg: "bg-info/10", icon: Loader2 },
  generating: { label: "Gerando", color: "text-primary", bg: "bg-primary/10", icon: Loader2 },
  done: { label: "Concluído", color: "text-accent", bg: "bg-accent/10", icon: CheckCircle2 },
  error: { label: "Erro", color: "text-destructive", bg: "bg-destructive/10", icon: AlertCircle },
};

export default function History() {
  const [, navigate] = useLocation();
  const { isAuthenticated, loading } = useAuth();
  const utils = trpc.useUtils();

  const { data: documents, isLoading } = trpc.documents.list.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 5000,
  });

  const deleteDoc = trpc.documents.delete.useMutation({
    onSuccess: () => {
      utils.documents.list.invalidate();
      toast.success("Documento excluído.");
    },
    onError: () => toast.error("Erro ao excluir documento."),
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <FileText className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>
            Acesse seu histórico
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            Faça login para ver seus documentos gerados.
          </p>
          <Button onClick={() => window.location.href = getLoginUrl()} className="gap-2">
            Entrar
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container py-4 flex items-center justify-between">
          <button onClick={() => navigate("/")} className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded flex items-center justify-center">
              <FileText className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-foreground text-sm">VideoDoc</span>
          </button>
          <Button onClick={() => navigate("/upload")} size="sm" className="gap-2 h-8 text-xs">
            <Plus className="w-3.5 h-3.5" />
            Novo Documento
          </Button>
        </div>
      </div>

      <div className="container py-10 max-w-3xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>
            Histórico
          </h1>
          <p className="text-sm text-muted-foreground">
            {documents?.length ?? 0} documento{documents?.length !== 1 ? "s" : ""} gerado{documents?.length !== 1 ? "s" : ""}
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : !documents?.length ? (
          <div className="text-center py-20">
            <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText className="w-10 h-10 text-muted-foreground" />
            </div>
            <h3 className="font-semibold text-foreground mb-2">Nenhum documento ainda</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Envie um vídeo para gerar sua primeira documentação consultiva.
            </p>
            <Button onClick={() => navigate("/upload")} className="gap-2">
              <Plus className="w-4 h-4" />
              Criar primeiro documento
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {documents.map(doc => {
              const statusCfg = STATUS_CONFIG[doc.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.pending;
              const StatusIcon = statusCfg.icon;
              const isProcessing = !["done", "error"].includes(doc.status);

              return (
                <div
                  key={doc.id}
                  className="bg-white border border-border rounded-xl p-5 flex items-center gap-4 hover:border-primary/30 hover:shadow-sm transition-all duration-200 group"
                >
                  {/* Icon */}
                  <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center shrink-0", statusCfg.bg)}>
                    {isProcessing ? (
                      <Loader2 className={cn("w-5 h-5 animate-spin", statusCfg.color)} />
                    ) : (
                      <StatusIcon className={cn("w-5 h-5", statusCfg.color)} />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium text-sm text-foreground truncate">
                        {doc.title === "Processando..." && isProcessing ? "Gerando documento..." : doc.title}
                      </h3>
                      {doc.sourceType === "youtube" ? (
                        <Youtube className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      ) : (
                        <Upload className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{new Date(doc.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}</span>
                      <span>•</span>
                      <span className={cn("font-medium", statusCfg.color)}>{statusCfg.label}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {doc.status === "done" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/document/${doc.id}`)}
                        className="h-8 text-xs gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        Abrir
                        <ArrowRight className="w-3 h-3" />
                      </Button>
                    )}
                    {isProcessing && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/document/${doc.id}`)}
                        className="h-8 text-xs gap-1.5"
                      >
                        Ver progresso
                      </Button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm("Excluir este documento?")) {
                          deleteDoc.mutate({ id: doc.id });
                        }
                      }}
                      className="w-8 h-8 rounded-lg hover:bg-destructive/10 flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
