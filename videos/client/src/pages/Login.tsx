import { useState } from "react";
import { useLocation } from "wouter";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function Login() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const onAuthSuccess = async () => {
    await utils.auth.me.invalidate();
    navigate("/upload");
  };

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: onAuthSuccess,
    onError: e => toast.error(e.message),
  });
  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: onAuthSuccess,
    onError: e => toast.error(e.message),
  });

  const loading = loginMutation.isPending || registerMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "login") {
      loginMutation.mutate({ email, password });
    } else {
      if (password.length < 8) {
        toast.error("A senha deve ter ao menos 8 caracteres.");
        return;
      }
      registerMutation.mutate({ name, email, password });
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-3">
          <div className="flex justify-center">
            <div className="deloitte-stripe w-12 h-12 rounded flex items-center justify-center">
              <FileText className="w-6 h-6 text-white" />
            </div>
          </div>
          <CardTitle className="text-2xl">VideoDoc Consultivo</CardTitle>
          <CardDescription>
            {mode === "login" ? "Entre com sua conta" : "Crie sua conta"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "register" && (
              <div className="space-y-2">
                <Label htmlFor="name">Nome</Label>
                <Input id="name" value={name} onChange={e => setName(e.target.value)} required placeholder="Seu nome" />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="voce@empresa.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {mode === "login" ? "Entrar" : "Cadastrar"}
            </Button>
          </form>
          <div className="mt-4 text-center text-sm text-muted-foreground">
            {mode === "login" ? (
              <button type="button" className="underline hover:text-foreground" onClick={() => setMode("register")}>
                Não tem conta? Cadastre-se
              </button>
            ) : (
              <button type="button" className="underline hover:text-foreground" onClick={() => setMode("login")}>
                Já tem conta? Entrar
              </button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
