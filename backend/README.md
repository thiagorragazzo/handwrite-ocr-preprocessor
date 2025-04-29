## Handwriting OCR Pre-Processor Backend

### Requisitos
- Python 3.6 ou superior (não funciona com Python 2.7)

### Instalação

```bash
# Certifique-se de usar Python 3
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Executar (desenvolvimento)

```bash
# Se a porta 8000 estiver em uso, mude para outra porta
uvicorn main:app --reload --port 8001
```

Abra http://localhost:8001/docs para acessar a interface Swagger UI.

### Solução de problemas

1. Se a porta 8000 estiver em uso, use outra porta como 8001
2. Certifique-se de usar Python 3 e não Python 2.7
3. Se tiver problemas com OpenCV, verifique que as dependências de sistema estão instaladas