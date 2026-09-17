# ─────────────────────────────────────────────────────────
# Backend Dockerfile — ARM64 compatible
# Base: python:3.11-slim (official multiarch, supports ARM64)
# ─────────────────────────────────────────────────────────

FROM python:3.11-slim-bookworm

# System dependencies for PyAudio (ALSA) + audio encoding (lean, avoids heavy GUI/Mesa/LLVM)
RUN echo 'Acquire::http::Pipeline-Depth "0";' > /etc/apt/apt.conf.d/99fixbadproxy \
    && echo 'Acquire::http::No-Cache "true";' >> /etc/apt/apt.conf.d/99fixbadproxy \
    && echo 'Acquire::BrokenProxy "true";' >> /etc/apt/apt.conf.d/99fixbadproxy \
    && echo 'Acquire::ForceIPv4 "true";' >> /etc/apt/apt.conf.d/99fixbadproxy \
    && echo 'Acquire::Retries "5";' >> /etc/apt/apt.conf.d/99fixbadproxy \
    && (sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list /etc/apt/sources.list.d/*.sources 2>/dev/null || true) \
    && (sed -i 's|http://security.debian.org|https://security.debian.org|g' /etc/apt/sources.list /etc/apt/sources.list.d/*.sources 2>/dev/null || true) \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
    gcc \
    libc6-dev \
    portaudio19-dev \
    libasound2-dev \
    alsa-utils \
    libsndfile1 \
    libgomp1 \
    curl \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (layer cache optimization)
COPY requirements.txt .
RUN for i in 1 2 3; do pip install --default-timeout=120 --retries=10 -r requirements.txt && break || (echo "Retry $i failed, retrying in 3s..." && sleep 3); done \
    && rm -rf /root/.cache/pip

# Copy source
COPY . .

# Create storage directories
RUN mkdir -p /app/storage/recordings

# Non-root user for security (but needs audio group — handled at runtime via group_add)
# RUN useradd -m -u 1000 appuser && chown -R appuser /app
# USER appuser

EXPOSE 8013

CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8013", "--log-level", "info"]

