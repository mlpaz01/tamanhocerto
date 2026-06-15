# Deploy gratuito na nuvem — Fly.io + Groq + TiDB

Stack 100% free tier, funcionando ponta a ponta:

- **App:** Fly.io (Docker, disco persistente, sempre disponível)
- **Transcrição:** Groq (Whisper hospedado, free) — sem CPU pesada
- **LLM:** OpenRouter
- **Banco:** TiDB Cloud Serverless (compatível com MySQL, free)
- **Storage:** volume persistente do Fly em `/data`

## Contas que VOCÊ precisa criar (grátis)

1. **Groq** → https://console.groq.com → crie uma **API key**.
2. **TiDB Cloud** → https://tidbcloud.com → crie um cluster **Serverless** (free) e copie a
   *connection string* (formato MySQL).
3. **Fly.io** → https://fly.io → instale o `flyctl` e faça login.
4. **OpenRouter** → a key que você já tem (gere uma nova, a antiga foi exposta no chat).

> Me avise quando tiver as contas — me passe as chaves de forma segura (NÃO cole no chat;
> eu te mostro como colocar direto via `fly secrets`).

## Passo a passo

### 1. Instalar o flyctl e logar
```powershell
# Windows
iwr https://fly.io/install.ps1 -useb | iex
fly auth login
```

### 2. Criar as tabelas no TiDB (rodado do seu PC)
```powershell
$env:DATABASE_URL = "mysql://usuario:senha@host:4000/videodoc?ssl={\"rejectUnauthorized\":true}"
pnpm db:push
```
(TiDB exige SSL — a connection string deles já vem com os parâmetros certos.)

### 3. Lançar o app no Fly
```powershell
cd C:\video-doc-engine
fly launch --no-deploy        # confirme o nome do app e a região (gru = São Paulo)
fly volumes create videodoc_data --size 3 --region gru   # disco persistente 3GB
```

### 4. Configurar os segredos (não vão pro código)
```powershell
fly secrets set `
  JWT_SECRET=$(openssl rand -hex 32) `
  DATABASE_URL="mysql://usuario:senha@host:4000/videodoc?ssl={\"rejectUnauthorized\":true}" `
  OPENROUTER_API_KEY="sk-or-..." `
  GROQ_API_KEY="gsk_..." `
  OWNER_EMAIL="voce@email.com" `
  PUBLIC_URL="https://SEU-APP.fly.dev"
```

### 5. Deploy
```powershell
fly deploy
fly open        # abre o app no navegador
```

Cadastre-se com o `OWNER_EMAIL` (vira admin) e teste o fluxo: upload/YouTube →
transcrição (Groq) → documento (OpenRouter) → download DOCX.

## Atualizações automáticas

Igual à Hostinger: depois de configurado, atualizar é só `fly deploy` — eu rodo por você
sempre que houver mudanças (basta eu ter o `flyctl` autenticado nesta máquina).

## Observações

- **Limite de áudio na Groq:** ~25MB por requisição. O ffmpeg já extrai o áudio em WAV
  16kHz mono (~1,9MB/min), cobrindo reuniões de ~13min. Vídeos mais longos exigiriam
  fatiar o áudio (posso implementar se precisar).
- **Trocar pra Whisper local depois:** basta `TRANSCRIBE_PROVIDER=local` + uma VM com mais
  RAM (o código dos dois modos já está pronto).
- **auto_stop_machines:** o app "dorme" sem tráfego e acorda na 1ª visita (economia no free).
