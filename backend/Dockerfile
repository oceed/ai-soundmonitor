# ─────────────────────────────────────────────────────────
# Backend Dockerfile — ARM64 compatible
# Base: python:3.11-slim (official multiarch, supports ARM64)
# ─────────────────────────────────────────────────────────

FROM python:3.11-slim-bookworm

# System dependencies for PyAudio (ALSA) + audio encoding
RUN echo 'Acquire::http::Pipeline-Depth "0";' > /etc/apt/apt.conf.d/99fixbadproxy \
    && echo 'Acquire::http::No-Cache "true";' >> /etc/apt/apt.conf.d/99fixbadproxy \
    && echo 'Acquire::BrokenProxy "true";' >> /etc/apt/apt.conf.d/99fixbadproxy \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
    build-essential \
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

EXPOSE 8013

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8013", "--log-level", "info"]
