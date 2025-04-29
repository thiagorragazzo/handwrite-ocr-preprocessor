# Handwriting OCR Pre-Processor

Aplicativo completo para pré-processamento de imagens de escrita manual, preparando-as para OCR (Reconhecimento Óptico de Caracteres).

## 📋 Funcionalidades

- Conversão para escala de cinza
- Equalização de histograma CLAHE
- Desfoque gaussiano (redução de ruído)
- Limiarização adaptativa (binarização)
- Correção de inclinação (rotação automática)
- Saída em PNG otimizado

## 🚀 Execução simplificada

Execute apenas um comando:

```bash
./start.sh
```

Este script cuida de:
1. Criar o ambiente virtual Python
2. Instalar as dependências
3. Iniciar o servidor backend
4. Abrir o frontend no navegador

## 📦 Execução manual

### Backend (FastAPI + OpenCV)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

### Frontend

Abra o arquivo `frontend/index.html` no seu navegador após iniciar o backend.

## 🔧 Requisitos

- Python 3.6 ou superior
- Navegador web moderno

## 📝 Notas

- API Swagger disponível em: http://localhost:8001/docs
- O processamento é feito totalmente local, sem dependências externas
- Ideal para melhorar imagens antes de usar serviços de OCR

---

Desenvolvido com FastAPI, OpenCV e tecnologias web padrão.