#!/bin/bash

echo "🚀 Inicializando Handwriting OCR Pre-Processor"

# Ir para o diretório backend
cd "$(dirname "$0")/backend"

# Criar e ativar ambiente virtual se não existir
if [ ! -d ".venv" ]; then
  echo "📦 Criando ambiente virtual..."
  python3 -m venv .venv
fi

# Ativar ambiente virtual
echo "🔌 Ativando ambiente virtual..."
source .venv/bin/activate

# Instalar dependências
echo "📚 Instalando dependências..."
pip install -r requirements.txt

# Iniciar servidor FastAPI em segundo plano
echo "🌐 Iniciando servidor FastAPI na porta 8001..."
uvicorn main:app --reload --port 8001 &
SERVER_PID=$!

# Aguardar o servidor iniciar
echo "⏳ Aguardando servidor iniciar..."
sleep 3

# Abrir o frontend no navegador padrão
echo "🖥️ Abrindo frontend no navegador..."
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
echo "✅ Aplicativo iniciado! Pressione Ctrl+C para encerrar."
echo "   - Backend: http://localhost:8001/docs"
echo "   - Frontend: Aberto no navegador"

# Capturar Ctrl+C para encerrar o servidor em segundo plano
trap "kill $SERVER_PID; echo '👋 Aplicativo encerrado!'; exit" SIGINT

# Manter o script rodando
wait $SERVER_PID