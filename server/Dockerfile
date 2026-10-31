# Server image. Build with real models:  docker build --build-arg ML=1 -t bolbridge-server .
FROM python:3.11-slim

ARG ML=0
RUN apt-get update && apt-get install -y --no-install-recommends espeak-ng && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements*.txt ./
RUN if [ "$ML" = "1" ]; then pip install --no-cache-dir -r requirements-ml.txt; else pip install --no-cache-dir -r requirements.txt; fi
COPY app ./app

ENV DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
