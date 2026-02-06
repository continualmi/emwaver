FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app.py ./app.py
COPY backend/emw_backend ./emw_backend

ENV PORT=8787
EXPOSE 8787

# Use gunicorn for production (Azure-friendly).
# NOTE: WebSockets require a WS-capable worker. We also keep workers=1 because
# the remote-session router is in-memory (no cross-worker sharing).
CMD ["gunicorn", "-b", "0.0.0.0:8787", "app:app", "-k", "geventwebsocket.gunicorn.workers.GeventWebSocketWorker", "--workers", "1", "--timeout", "90"]
