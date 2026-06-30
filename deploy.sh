#!/bin/bash
# PDF Editor — Deploy to home server (ssh host: home)
# Usage: bash deploy.sh

set -e
SERVER="home"
REMOTE="~/pdf-editor"

echo "[1/3] Syncing files..."
scp server.js package.json package-lock.json "$SERVER:$REMOTE/"
scp public/index.html "$SERVER:$REMOTE/public/"
scp public/css/style.css "$SERVER:$REMOTE/public/css/"
scp public/js/app.js "$SERVER:$REMOTE/public/js/"

echo "[2/3] Rebuilding Docker image..."
ssh "$SERVER" "cd $REMOTE && docker compose up -d --build"

echo "[3/3] Done!"
ssh "$SERVER" "docker ps | grep pdf-editor"
