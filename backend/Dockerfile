# ─────────────────────────────────────────────────────────
# Backend Dockerfile — ARM64 compatible
# Base: python:3.11-slim (official multiarch, supports ARM64)
# ─────────────────────────────────────────────────────────

FROM python:3.11-slim

# System dependencies for PyAudio (ALSA) + audio encoding
RUN apt-get update && apt-get install -y --no-install-recommends \
    portaudio19-dev \
    libasound2-dev \
    alsa-utils \
    ffmpeg \
    libsndfile1 \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (layer cache optimization)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . .

# Create storage directories
RUN mkdir -p /app/storage/recordings

# Non-root user for security (but needs audio group — handled at runtime via group_add)
# RUN useradd -m -u 1000 appuser && chown -R appuser /app
# USER appuser

EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--log-level", "info"]
