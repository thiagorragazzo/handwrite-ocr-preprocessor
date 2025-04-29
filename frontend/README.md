# Handwriting OCR Pre-Processor Frontend

## How to Use

1. Make sure the backend is running first:
   ```bash
   cd ../backend
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   uvicorn main:app --reload --port 8001
   ```

2. Open the `index.html` file in your browser

3. Upload an image with handwritten text

4. Click "Process" to process the image

5. The processed image will appear below

## Configuration

The frontend is configured to connect to the backend on port 8001. If you're using a different port, edit the line `const serverUrl = 'http://localhost:8001/process';` in the index.html file.