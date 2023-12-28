FROM mcr.microsoft.com/playwright:v1.40.1

WORKDIR /app

# Copy application files (see .dockerignore for what's excluded)
COPY . .

RUN npm ci
RUN npm run build:lib # needed for self-import in tests
RUN npm run prepare

ENTRYPOINT ["npx", "playwright", "test"]
