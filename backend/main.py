from fastapi import FastAPI, File, UploadFile, Response
from fastapi.middleware.cors import CORSMiddleware
from image_utils import preprocess_image

app = FastAPI(title="Handwriting Pre-Processor")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/process")
async def process(file: UploadFile = File(...)):
    raw = await file.read()
    enhanced = preprocess_image(raw)
    return Response(
        content=enhanced,
        media_type="image/png",
        headers={"Content-Disposition": 'attachment; filename="processed.png"'}
    )