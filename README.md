# Handwriting OCR Pre-Processor

A complete application for preprocessing handwritten text images to prepare them for OCR (Optical Character Recognition).

## 📋 Features

- Grayscale conversion
- CLAHE histogram equalization
- Gaussian blur (noise reduction)
- Adaptive thresholding (binarization)
- Deskewing (automatic rotation correction)
- Optimized PNG output

## 🚀 Quick Start

Run with a single command:

```bash
./start.sh
```

This script takes care of:
1. Creating the Python virtual environment
2. Installing dependencies
3. Starting the backend server
4. Opening the frontend in your browser

## 📦 Manual Setup

### Backend (FastAPI + OpenCV)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

### Frontend

Open the `frontend/index.html` file in your browser after starting the backend.

## 🔧 Requirements

- Python 3.6 or higher
- Modern web browser

## 📝 Notes

- Swagger API documentation available at: http://localhost:8001/docs
- Processing is done entirely locally, with no external dependencies
- Ideal for improving images before using OCR services

---

Developed with FastAPI, OpenCV and standard web technologies.