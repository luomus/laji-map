FROM mcr.microsoft.com/playwright:v1.40.1

WORKDIR /app

# Copy application files (see .dockerignore for what's excluded)
COPY . .

# Install dependencies
RUN npm ci
RUN npm run build:lib
RUN npm run prepare

ENTRYPOINT ["npx", "playwright", "test"]
