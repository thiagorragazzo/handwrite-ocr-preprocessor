# Handwriting OCR Pre-Processor Frontend

## Como usar

1. Certifique-se que o backend está rodando primeiro:
   ```bash
   cd ../backend
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   uvicorn main:app --reload --port 8001
   ```

2. Abra o arquivo `index.html` no seu navegador

3. Faça upload de uma imagem com escrita manual

4. Clique em "Process" para processar a imagem

5. A imagem processada aparecerá abaixo

## Configuração

O frontend está configurado para se conectar ao backend na porta 8001. Se você estiver usando uma porta diferente, edite a linha `const serverUrl = 'http://localhost:8001/process';` no arquivo index.html.