FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app.py ./app.py
COPY backend/emw_backend ./emw_backend

ENV PORT=8787
EXPOSE 8787

# Use gunicorn for production (Azure-friendly).
CMD ["gunicorn", "-b", "0.0.0.0:8787", "app:app", "--workers", "2", "--threads", "4", "--timeout", "90"]
