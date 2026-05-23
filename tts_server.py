import io
import os
import warnings

# Keep models in the project directory instead of ~/.cache/huggingface
os.environ['HF_HOME'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models')
# Suppress noisy HF hub and transformers warnings
os.environ['TRANSFORMERS_VERBOSITY'] = 'error'
os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
warnings.filterwarnings('ignore')

import numpy as np
import noisereduce as nr
import scipy.io.wavfile as wavfile
import torch
import uvicorn
from fastapi import FastAPI
from fastapi.responses import Response
from pydantic import BaseModel
from transformers import AutoProcessor, SeamlessM4Tv2ForTextToSpeech, logging as hf_logging

hf_logging.set_verbosity_error()

print("Loading SeamlessM4T v2 Large — first run downloads ~2.5 GB...", flush=True)

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
MODEL_ID = "facebook/seamless-m4t-v2-large"

processor = AutoProcessor.from_pretrained(MODEL_ID)
model = SeamlessM4Tv2ForTextToSpeech.from_pretrained(
    MODEL_ID,
    ignore_mismatched_sizes=True,
).to(DEVICE)
model.eval()

SAMPLE_RATE = 16000

print("TTS server ready.", flush=True)

app = FastAPI()


def postprocess(audio_float: np.ndarray, sr: int = SAMPLE_RATE) -> np.ndarray:
    # 1. Spectral noise reduction — non-stationary to catch transient bursts
    audio_float = nr.reduce_noise(
        y=audio_float,
        sr=sr,
        stationary=False,
        prop_decrease=0.85,
        n_fft=512,
        n_jobs=1,
    )

    # 2. Trim leading/trailing silence (model often produces noisy tail frames)
    threshold = 0.004
    above = np.where(np.abs(audio_float) > threshold)[0]
    if len(above) > 0:
        pad = int(sr * 0.04)  # 40ms padding so speech isn't clipped
        start = max(0, above[0] - pad)
        end = min(len(audio_float), above[-1] + pad)
        audio_float = audio_float[start:end]

    # 3. Normalize to 95% peak to leave headroom
    peak = np.abs(audio_float).max()
    if peak > 0:
        audio_float = audio_float / peak * 0.95

    return (audio_float * 32767).astype(np.int16)


class TTSRequest(BaseModel):
    text: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/tts")
def tts(req: TTSRequest):
    inputs = processor(text=req.text, src_lang="ind", return_tensors="pt").to(DEVICE)
    with torch.no_grad():
        output = model.generate(**inputs, tgt_lang="ind")

    audio_float = output[0][0].cpu().numpy().astype(np.float32)
    audio_int16 = postprocess(audio_float)

    buf = io.BytesIO()
    wavfile.write(buf, SAMPLE_RATE, audio_int16)
    buf.seek(0)
    return Response(content=buf.read(), media_type="audio/wav")


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=5002, log_level="warning")
