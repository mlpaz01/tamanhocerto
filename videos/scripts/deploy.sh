#!/usr/bin/env bash
# Deploy/atualização do VideoDoc Engine no VPS.
# Rode no servidor, dentro da pasta do projeto:  bash scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo ">>> git pull..."
git pull --ff-only || echo "(sem git remoto ou já atualizado)"

echo ">>> Instalando dependências..."
pnpm install --frozen-lockfile

echo ">>> Aplicando migrações do banco..."
pnpm db:push

echo ">>> Build..."
pnpm build

echo ">>> Reiniciando serviço..."
sudo systemctl restart videodoc
sleep 2
sudo systemctl --no-pager status videodoc | head -n 12

echo ">>> Deploy concluído. Logs: journalctl -u videodoc -f"
