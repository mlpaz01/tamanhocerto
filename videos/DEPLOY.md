# VideoDoc Engine — Deploy no VPS Oracle (self-hosted)

Versão do `video-doc-deloitte` desacoplada da plataforma Manus/Forge. Roda em qualquer
VPS Linux com:

- **LLM:** OpenRouter (compatível com OpenAI)
- **Transcrição:** Whisper local (`faster-whisper`) — sem custo por uso
- **Storage:** disco local
- **Auth:** e-mail/senha própria (JWT em cookie httpOnly)
- **Banco:** MySQL

## Arquitetura

```
Navegador ──HTTPS──> nginx ──proxy──> Node (Express+tRPC, porta 3000)
                                         │
            ┌────────────────────────────┼─────────────────────────────┐
            ▼                            ▼                              ▼
   yt-dlp + ffmpeg              faster-whisper (Python)        OpenRouter (LLM)
   (baixa/extrai áudio)         (transcreve no VPS)            (gera o documento)
            │                                                          │
            └──────────────> disco (data/storage) <───── docx gerado ─┘
```

## Por que Oracle Cloud free tier funciona bem

A instância **Ampere A1 (ARM)** do free tier oferece até 4 vCPU / 24 GB RAM — suficiente
para rodar o Whisper `small`/`medium` em CPU sem pagar nada por transcrição.

## Passo a passo

### 1. Criar a VM
- Oracle Cloud → Compute → Instance → shape **VM.Standard.A1.Flex** (Ampere/ARM), Ubuntu 22.04.
- Em **Security List / NSG**, libere as portas **80** e **443** (ingress).

### 2. Provisionar (uma vez)
```bash
git clone <seu-repo> video-doc-engine   # ou envie os arquivos via scp
cd video-doc-engine
bash scripts/setup-oracle.sh
```
Instala Node 22, pnpm, ffmpeg, yt-dlp e cria um venv com `faster-whisper`.

### 3. Banco MySQL
```bash
sudo apt-get install -y mysql-server
sudo mysql -e "CREATE DATABASE videodoc; CREATE USER 'videodoc'@'localhost' IDENTIFIED BY 'TROQUE'; GRANT ALL ON videodoc.* TO 'videodoc'@'localhost'; FLUSH PRIVILEGES;"
```

### 4. Configurar `.env`
```bash
cp .env.example .env
# edite: JWT_SECRET (openssl rand -hex 32), DATABASE_URL, OPENROUTER_API_KEY,
#        OWNER_EMAIL, PUBLIC_URL e WHISPER_PYTHON=$HOME/.venv-whisper/bin/python
```

### 5. Build + migração + serviço
```bash
pnpm install
pnpm build
pnpm db:push                                  # cria as tabelas (inclui passwordHash)
sudo cp deploy/videodoc.service /etc/systemd/system/
# ajuste User/WorkingDirectory no .service se necessário
sudo systemctl daemon-reload
sudo systemctl enable --now videodoc
```

### 6. nginx + HTTPS
```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo cp deploy/nginx.conf /etc/nginx/sites-available/videodoc
sudo ln -s /etc/nginx/sites-available/videodoc /etc/nginx/sites-enabled/
# troque "seu-dominio.com" no arquivo
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d seu-dominio.com
```

Acesse `https://seu-dominio.com`, vá em **/login**, cadastre-se com o `OWNER_EMAIL`
(vira admin) e comece a enviar vídeos.

## Atualizações automáticas

Mesma mecânica da Hostinger: configurado o acesso SSH, o deploy de uma nova versão é:
```bash
bash scripts/deploy.sh   # git pull + install + db:push + build + restart
```
Posso rodar isso por você sempre que houver mudanças.

## Notas de operação

- **Tamanho do áudio:** não há limite de 25 MB (era restrição da API da OpenAI). O ffmpeg
  extrai o áudio localmente, então vídeos longos funcionam — limitados por tempo de CPU.
- **Modelo Whisper:** comece com `small`. Se quiser mais precisão e a CPU aguentar, use
  `medium`. Defina em `WHISPER_MODEL`.
- **Logs:** `journalctl -u videodoc -f`.
- **Storage:** os arquivos ficam em `data/storage/`. Faça backup dessa pasta + dump do MySQL.
