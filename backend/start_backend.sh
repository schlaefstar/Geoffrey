#!/bin/bash
# Stop any existing instance
npx pm2 delete geoffrey-backend 2>/dev/null || true

# Start the server with PM2
# --name: gives it a friendly name
# --time: adds timestamps to logs
npx pm2 start server.js --name "geoffrey-backend" --time

echo "✅ Backend started with PM2!"
echo "commands:"
echo "  Monitor: npx pm2 monit"
echo "  Logs:    npx pm2 logs geoffrey-backend"
echo "  Stop:    npx pm2 stop geoffrey-backend"
