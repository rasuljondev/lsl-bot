module.exports = {
  apps: [
    {
      name: "lsl-bot",
      script: "src/bot.js",
      cwd: __dirname,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: "10s",
      time: true,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
