#!/bin/bash

echo "🚀 Initializing Handwriting OCR Pre-Processor"

# Go to the backend directory
cd "$(dirname "$0")/backend"

# Create and activate virtual environment if it doesn't exist
if [ ! -d ".venv" ]; then
  echo "📦 Creating virtual environment..."
  python3 -m venv .venv
fi

# Activate virtual environment
echo "🔌 Activating virtual environment..."
source .venv/bin/activate

# Install dependencies
echo "📚 Installing dependencies..."
pip install -r requirements.txt

# Start FastAPI server in the background
echo "🌐 Starting FastAPI server on port 8001..."
uvicorn main:app --reload --port 8001 &
SERVER_PID=$!

# Wait for the server to start
echo "⏳ Waiting for server to start..."
sleep 3

# Open the frontend in the default browser
echo "🖥️ Opening frontend in browser..."
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS
  open "../frontend/index.html"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
  # Linux
  xdg-open "../frontend/index.html"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
  # Windows
  start "../frontend/index.html"
fi

echo ""
echo "✅ Application started! Press Ctrl+C to exit."
echo "   - Backend: http://localhost:8001/docs"
echo "   - Frontend: Opened in browser"

# Capture Ctrl+C to terminate the background server
trap "kill $SERVER_PID; echo '👋 Application terminated!'; exit" SIGINT

# Keep the script running
wait $SERVER_PID