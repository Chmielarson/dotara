// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'dotara-io-server',
    script: './server/index.js',
    instances: 4, // Uruchom 4 instancje dla lepszej wydajności
    exec_mode: 'cluster',
    instance_var: 'INSTANCE_ID',
    watch: false,
    max_memory_restart: '2G',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
      // Optymalizacje Node.js
      NODE_OPTIONS: '--max-old-space-size=2048',
      UV_THREADPOOL_SIZE: 128,
      // Feature flags
      USE_DELTA_COMPRESSION: 'true', // Na razie wyłączone
      USE_BINARY_PROTOCOL: 'true', // Na razie wyłączone
    },
    // PM2+ monitoring
    pmx: true,
    // Auto restart on crash
    autorestart: true,
    // Delay between restarts
    restart_delay: 5000,
    // Max restarts in 1 minute
    max_restarts: 10,
    min_uptime: '10s',
    // Load balancing between instances
    instances_var: 'INSTANCE_ID',
    merge_logs: true,
    // Graceful reload
    kill_timeout: 5000,
    listen_timeout: 3000,
    // Cron restart (optional - restart every day at 4 AM)
    // cron_restart: '0 4 * * *',
  }]
}