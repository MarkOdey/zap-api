# Debian, not Alpine: onnxruntime-node (via @huggingface/transformers) ships no
# musl build and fails with ERR_DLOPEN_FAILED on alpine. Because session.js
# imports the vision actions at load time, that breaks server startup entirely,
# not just the vision actions.
FROM node:24-slim

# ffmpeg — crop / normalize / concat / segment
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Model weights land here; mount it as a volume or every container start
# re-downloads ~200MB from the Hugging Face Hub.
ENV MODEL_CACHE_DIR=/app/.models

# Kokoro's weights land in the same cache; mount it or they re-download.

CMD ["npm", "run", "start"]
