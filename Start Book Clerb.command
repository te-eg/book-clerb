#!/bin/bash
# Book Clerb Launcher — no installation needed
cd "$(dirname "$0")"

echo "📚 Starting The Book Clerb..."

# Open the browser after the server has had a moment to start
(sleep 2 && open "http://localhost:3000") &

node server.js
