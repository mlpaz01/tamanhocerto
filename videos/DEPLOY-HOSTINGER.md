# Deploy na VPS Hostinger — tamanhocerto.com.br/videos

Segue o mesmo padrão dos outros projetos da VPS (PM2 + Nginx + MySQL), na **porta 3012**
e atrás do prefixo `/videos` (Nginx faz strip do prefixo).

## Pré-requisitos na VPS (já existem para os outros sites)
- Node + pnpm, PM2, Nginx, MySQL
- ffmpeg e yt-dlp (instalar se ainda não houver): `sudo apt-get install -y ffmpeg && sudo curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod a+rx /usr/local/bin/yt-dlp`

## 1. GitHub primeiro (protocolo obrigatório)
```bash
# local
git init && git add . && git commit -m "VideoDoc Engine self-hosted"
gh repo create video-doc-engine --private --source=. --push   # ou git remote add + push
```

## 2. Banco MySQL na VPS
```bash
sudo mysql -e "CREATE DATABASE videodoc CHARACTER SET utf8mb4; \
CREATE USER 'videodoc'@'localhost' IDENTIFIED BY 'TROQUE'; \
GRANT ALL ON videodoc.* TO 'videodoc'@'localhost'; FLUSH PRIVILEGES;"
```

## 3. Clonar e configurar na VPS
```bash
cd /var/www
git clone <repo> video-doc-engine && cd video-doc-engine
cp deploy/.env.producao.example .env   # edite: JWT_SECRET, DATABASE_URL, OPENROUTER_API_KEY,
                                        # GROQ_API_KEY (ou TRANSCRIBE_PROVIDER=local), OWNER_EMAIL
```

## 4. Build + migração (com o prefixo /videos)
```bash
pnpm install
VITE_BASE_PATH=/videos/ NODE_ENV=production pnpm build
pnpm db:push        # cria as tabelas
```

## 5. Subir no PM2
```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 logs videodoc
```

## 6. Nginx
Cole o conteúdo de `deploy/nginx-videos.conf` dentro do `server { }` de tamanhocerto.com.br
(o mesmo que já tem o SSL), depois:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

Acesse **https://tamanhocerto.com.br/videos**, cadastre-se com o `OWNER_EMAIL` e teste.

## Atualizações (mesma mecânica de sempre)
```bash
cd /var/www/video-doc-engine && git pull
pnpm install
VITE_BASE_PATH=/videos/ NODE_ENV=production pnpm build
pnpm db:push
pm2 restart videodoc
```

## Importante
- **Transcrição:** a OpenRouter só gera o documento (LLM). O áudio precisa de **Groq**
  (key grátis em console.groq.com → `TRANSCRIBE_PROVIDER=groq`) **ou** Whisper local
  (`TRANSCRIBE_PROVIDER=local` + Python/faster-whisper instalados — pesa mais na VPS).
- **PUBLIC_URL** precisa terminar em `/videos` para os links de download do DOCX funcionarem.
