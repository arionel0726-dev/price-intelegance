# Production image for the Python parser service.
#
# Base is Microsoft's official Playwright Python image, pinned to the SAME
# Playwright version this project uses (see requirements.txt) - it ships
# Chromium plus every system dependency Playwright needs already installed
# and version-matched, which is far more reliable than manually apt-installing
# Chromium's dependency list on a bare python:slim image (easy to silently
# miss one and only find out when a MAKEUP search/parse call fails at
# runtime). OVICO and Vizaje don't need a browser at all (plain httpx), but
# MAKEUP does, so this image is shared by all three code paths.
#
# Build from the REPO ROOT: docker build -f services/parser/Dockerfile .

FROM mcr.microsoft.com/playwright/python:v1.62.0-noble

WORKDIR /app

COPY services/parser/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY services/parser/app app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
