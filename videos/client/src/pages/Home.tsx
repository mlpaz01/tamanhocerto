import { useLocation } from "wouter";
import { ArrowRight, FileText, Zap, Shield, BarChart3, CheckCircle2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";

const features = [
  {
    icon: Zap,
    title: "Transcrição Automática",
    description: "Áudio extraído e transcrito via Whisper com alta precisão, suportando MP4 e links do YouTube.",
  },
  {
    icon: FileText,
    title: "Padrão Deloitte",
    description: "Documento estruturado com Visão Executiva, Processo Ponta a Ponta, Responsabilidades, Riscos, Recomendações e Próximos Passos.",
  },
  {
    icon: BarChart3,
    title: "Análise por LLM",
    description: "Inteligência artificial analisa o conteúdo e gera insights consultivos acionáveis com linguagem executiva.",
  },
  {
    icon: Shield,
    title: "Armazenamento Seguro",
    description: "Vídeos e documentos armazenados com segurança. Histórico vinculado à sua conta.",
  },
];

const steps = [
  { number: "01", label: "Upload", description: "Envie um MP4 ou cole um link do YouTube" },
  { number: "02", label: "Transcrição", description: "Áudio convertido em texto automaticamente" },
  { number: "03", label: "Análise", description: "LLM processa e estrutura o conteúdo" },
  { number: "04", label: "Documento", description: "Download em DOCX ou PDF, pronto para uso" },
];

export default function Home() {
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();

  const handleCTA = () => {
    if (isAuthenticated) {
      navigate("/upload");
    } else {
      window.location.href = getLoginUrl();
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* ── Nav ── */}
      <nav className="border-b border-border bg-white/90 backdrop-blur-sm sticky top-0 z-20">
        <div className="container py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="deloitte-stripe w-8 h-8 rounded flex items-center justify-center">
              <FileText className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-foreground tracking-tight">VideoDoc</span>
            <span className="text-xs text-muted-foreground border border-border px-2 py-0.5 rounded-full hidden sm:inline">
              Padrão Consultivo
            </span>
          </div>
          <div className="flex items-center gap-3">
            {isAuthenticated && (
              <button
                onClick={() => navigate("/history")}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Histórico
              </button>
            )}
            <Button onClick={handleCTA} size="sm" className="gap-1.5">
              {isAuthenticated ? "Novo Documento" : "Começar"}
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="hero-gradient pt-20 pb-24 relative overflow-hidden">
        <div className="container text-center max-w-3xl animate-fade-in-up">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-primary border border-primary/20 bg-primary/5 px-3 py-1.5 rounded-full mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-accent inline-block" />
            Documentação consultiva gerada por IA
          </div>

          <h1
            className="text-4xl sm:text-5xl md:text-6xl font-bold text-foreground mb-6 leading-tight"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            Transforme reuniões em{" "}
            <span className="text-primary">documentação</span>{" "}
            executiva
          </h1>

          <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-10 leading-relaxed">
            Envie um vídeo MP4 ou link do YouTube e receba em minutos um documento estruturado no padrão consultivo Deloitte, pronto para download.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button onClick={handleCTA} size="lg" className="gap-2 h-12 px-8 text-sm font-semibold">
              <Play className="w-4 h-4" />
              {isAuthenticated ? "Criar novo documento" : "Começar gratuitamente"}
            </Button>
            {isAuthenticated && (
              <Button
                onClick={() => navigate("/history")}
                variant="outline"
                size="lg"
                className="h-12 px-8 text-sm"
              >
                Ver histórico
              </Button>
            )}
          </div>
        </div>

        {/* Decorative grid */}
        <div
          className="absolute inset-0 pointer-events-none opacity-30"
          style={{
            backgroundImage: "linear-gradient(oklch(0.34 0.12 255 / 0.06) 1px, transparent 1px), linear-gradient(90deg, oklch(0.34 0.12 255 / 0.06) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
      </section>

      {/* ── Steps ── */}
      <section className="py-20 border-y border-border bg-white">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold text-foreground mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>
              Como funciona
            </h2>
            <p className="text-muted-foreground text-sm">Quatro etapas automáticas, do vídeo ao documento</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto">
            {steps.map((step, i) => (
              <div key={step.number} className="relative text-center animate-fade-in-up" style={{ animationDelay: `${i * 80}ms` }}>
                {i < steps.length - 1 && (
                  <div className="hidden md:block absolute top-6 left-[calc(50%+2rem)] right-0 h-px bg-border" />
                )}
                <div className="w-12 h-12 rounded-full bg-primary/8 border border-primary/20 flex items-center justify-center mx-auto mb-3">
                  <span className="text-xs font-bold text-primary">{step.number}</span>
                </div>
                <p className="font-semibold text-foreground text-sm mb-1">{step.label}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="py-20">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold text-foreground mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>
              Capacidades da plataforma
            </h2>
            <p className="text-muted-foreground text-sm">Tecnologia de ponta para documentação consultiva</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 max-w-5xl mx-auto">
            {features.map((f, i) => (
              <div
                key={f.title}
                className="card-hover bg-white border border-border rounded-xl p-5 animate-fade-in-up"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="w-10 h-10 rounded-lg bg-primary/8 flex items-center justify-center mb-4">
                  <f.icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground text-sm mb-2">{f.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Document structure ── */}
      <section className="py-20 bg-white border-y border-border">
        <div className="container max-w-4xl">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4" style={{ fontFamily: "'Playfair Display', serif" }}>
                Estrutura do documento gerado
              </h2>
              <p className="text-muted-foreground text-sm mb-6 leading-relaxed">
                Cada documento segue rigorosamente o padrão consultivo Deloitte, com seções obrigatórias e linguagem executiva.
              </p>
              <Button onClick={handleCTA} className="gap-2">
                Gerar meu documento
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>

            <div className="space-y-2">
              {[
                "Visão Executiva",
                "Processo Ponta a Ponta",
                "Responsabilidades",
                "Riscos",
                "Recomendações",
                "Próximos Passos",
              ].map((section, i) => (
                <div
                  key={section}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border bg-background animate-fade-in-up"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <CheckCircle2 className="w-4 h-4 text-accent shrink-0" />
                  <span className="text-sm font-medium text-foreground">{section}</span>
                  <span className="ml-auto text-xs text-muted-foreground">Seção {i + 1}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-20">
        <div className="container max-w-2xl text-center">
          <h2 className="text-2xl font-bold text-foreground mb-4" style={{ fontFamily: "'Playfair Display', serif" }}>
            Pronto para transformar suas reuniões?
          </h2>
          <p className="text-muted-foreground text-sm mb-8 leading-relaxed">
            Envie seu primeiro vídeo e receba documentação consultiva profissional em minutos.
          </p>
          <Button onClick={handleCTA} size="lg" className="gap-2 h-12 px-10">
            <Play className="w-4 h-4" />
            {isAuthenticated ? "Criar novo documento" : "Começar agora"}
          </Button>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border py-8 bg-white">
        <div className="container flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="deloitte-stripe w-6 h-6 rounded flex items-center justify-center">
              <FileText className="w-3 h-3 text-white" />
            </div>
            <span className="text-sm font-medium text-foreground">VideoDoc Consultivo</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Documentação gerada por IA · Padrão Consultivo
          </p>
        </div>
      </footer>
    </div>
  );
}
