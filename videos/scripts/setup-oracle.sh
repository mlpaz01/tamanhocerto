#!/usr/bin/env bash
# Provisiona um VPS Oracle (Ubuntu 22.04+ / ARM ou x86) para rodar o VideoDoc Engine.
# Rode UMA VEZ como usuário com sudo:  bash scripts/setup-oracle.sh
set -euo pipefail

echo ">>> Atualizando pacotes..."
sudo apt-get update -y

echo ">>> Instalando ffmpeg, python, git, build tools..."
sudo apt-get install -y ffmpeg python3 python3-pip python3-venv git curl ca-certificates

echo ">>> Instalando Node.js 22 (NodeSource)..."
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo ">>> Instalando pnpm e yt-dlp..."
sudo npm install -g pnpm
sudo curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp

echo ">>> Criando venv Python e instalando faster-whisper..."
python3 -m venv "$HOME/.venv-whisper"
"$HOME/.venv-whisper/bin/pip" install --upgrade pip
"$HOME/.venv-whisper/bin/pip" install -r "$(dirname "$0")/requirements.txt"

echo ">>> MySQL (opcional — instale se for usar local):"
echo "    sudo apt-get install -y mysql-server && sudo mysql_secure_installation"

cat <<'EOF'

==========================================================
Setup concluído.

PRÓXIMOS PASSOS:
  1. Ajuste o .env (veja .env.example). Use:
       WHISPER_PYTHON=$HOME/.venv-whisper/bin/python
  2. Abra a porta no firewall do Oracle (Security List) e no host:
       sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
       sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
       sudo netfilter-persistent save   # se disponível
  3. pnpm install && pnpm build && pnpm db:push
  4. Instale o serviço systemd: deploy/videodoc.service
  5. Configure o nginx: deploy/nginx.conf
==========================================================
EOF
