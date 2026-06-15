// PM2 — VideoDoc Engine na VPS Hostinger.
// As variáveis sensíveis vêm do .env (carregado pelo próprio app via dotenv/config).
module.exports = {
  apps: [
    {
      name: "videodoc",
      script: "dist/index.js",
      cwd: "/var/www/video-doc-engine",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: "3012",
      },
      max_memory_restart: "500M",
      time: true,
    },
  ],
};
