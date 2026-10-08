FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libexpat1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml ./
COPY extractor ./extractor
COPY jobs ./jobs
RUN pip install --no-cache-dir . && useradd --system --uid 10001 jobs && mkdir /data && chown jobs /data
USER jobs
ENV DATA_DIR=/data PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/jobs/health', timeout=3)"
CMD ["python", "-m", "jobs"]
