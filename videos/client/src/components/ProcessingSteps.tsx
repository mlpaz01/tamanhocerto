import { Check, Loader2, Upload, Mic, Brain, FileText, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type ProcessingStatus =
  | "pending"
  | "uploading"
  | "transcribing"
  | "analyzing"
  | "generating"
  | "done"
  | "error";

const STEPS = [
  {
    id: "uploading",
    label: "Upload",
    description: "Enviando o vídeo para processamento",
    icon: Upload,
  },
  {
    id: "transcribing",
    label: "Transcrição",
    description: "Convertendo áudio em texto com Whisper AI",
    icon: Mic,
  },
  {
    id: "analyzing",
    label: "Análise",
    description: "Analisando o conteúdo da reunião",
    icon: Brain,
  },
  {
    id: "generating",
    label: "Geração",
    description: "Criando documentação no padrão Deloitte",
    icon: FileText,
  },
];

// Maps each status to the step index that is currently active (0-based)
const STATUS_TO_STEP: Record<ProcessingStatus, number> = {
  pending: -1,
  uploading: 0,
  transcribing: 1,
  analyzing: 2,
  generating: 3,
  done: 4,
  error: -1,
};

interface ProcessingStepsProps {
  status: ProcessingStatus;
  /** The status that was active right before the error occurred */
  lastActiveStatus?: ProcessingStatus;
  errorMessage?: string | null;
  className?: string;
}

export function ProcessingSteps({ status, lastActiveStatus, errorMessage, className }: ProcessingStepsProps) {
  // Determine which step index is in error state
  const errorStepIndex = status === "error"
    ? (lastActiveStatus ? STATUS_TO_STEP[lastActiveStatus] : -1)
    : -1;

  return (
    <div className={cn("w-full", className)}>
      {/* Steps row */}
      <div className="flex items-start justify-between relative">
        {/* Connector line */}
        <div className="absolute top-5 left-0 right-0 h-0.5 bg-border mx-10 z-0" />

        {STEPS.map((step, idx) => {
          const Icon = step.icon;

          // Determine visual state for this step
          let state: "pending" | "active" | "done" | "error";
          if (status === "error") {
            if (errorStepIndex === -1) {
              // Unknown error step: mark all as error
              state = "error";
            } else if (idx < errorStepIndex) {
              state = "done";
            } else if (idx === errorStepIndex) {
              state = "error";
            } else {
              state = "pending";
            }
          } else {
            const activeStep = STATUS_TO_STEP[status];
            if (idx < activeStep) state = "done";
            else if (idx === activeStep) state = "active";
            else state = "pending";
          }

          return (
            <div key={step.id} className="flex flex-col items-center gap-2 flex-1 relative z-10">
              {/* Circle */}
              <div
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-500",
                  state === "done" && "bg-primary border-primary text-white",
                  state === "active" && "bg-white border-primary text-primary pulse-ring",
                  state === "pending" && "bg-white border-border text-muted-foreground",
                  state === "error" && "bg-destructive border-destructive text-white",
                )}
              >
                {state === "done" ? (
                  <Check className="w-4 h-4" />
                ) : state === "active" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : state === "error" ? (
                  <AlertCircle className="w-4 h-4" />
                ) : (
                  <Icon className="w-4 h-4" />
                )}
              </div>

              {/* Label */}
              <div className="text-center">
                <p className={cn(
                  "text-xs font-semibold transition-colors duration-300",
                  state === "done" && "text-primary",
                  state === "active" && "text-primary",
                  state === "pending" && "text-muted-foreground",
                  state === "error" && "text-destructive",
                )}>
                  {step.label}
                </p>
                <p className={cn(
                  "text-[10px] leading-tight mt-0.5 max-w-[80px] text-center hidden sm:block",
                  state === "active" ? "text-foreground/70" : "text-muted-foreground",
                )}>
                  {step.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Error banner */}
      {status === "error" && errorMessage && (
        <div className="mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
          <p className="text-xs text-destructive">{errorMessage}</p>
        </div>
      )}

      {/* Success banner */}
      {status === "done" && (
        <div className="mt-4 p-3 rounded-lg bg-accent/10 border border-accent/20 flex items-center gap-2">
          <Check className="w-4 h-4 text-accent shrink-0" />
          <p className="text-xs text-accent font-medium">Documentação gerada com sucesso!</p>
        </div>
      )}
    </div>
  );
}
