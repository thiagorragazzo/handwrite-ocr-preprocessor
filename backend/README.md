## Handwriting OCR Pre-Processor Backend

### Requirements
- Python 3.6 or higher (does not work with Python 2.7)

### Installation

```bash
# Make sure to use Python 3
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Running (development)

```bash
# If port 8000 is in use, change to another port
uvicorn main:app --reload --port 8001
```

Open http://localhost:8001/docs to access the Swagger UI interface.

### Troubleshooting

1. If port 8000 is in use, use another port like 8001
2. Make sure you're using Python 3 and not Python 2.7
3. If you have issues with OpenCV, verify that system dependencies are installed