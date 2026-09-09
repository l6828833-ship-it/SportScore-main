# SportScore backend — container image for Google Cloud Run.
#
# Cloud Run runs a stateless container that must listen on $PORT (it injects
# one, defaulting to 8080). index.js already reads process.env.PORT, so nothing
# in the app changes.

FROM node:20-slim

# Puppeteer (used only by the best-effort /news routes) otherwise downloads a
# ~150MB Chromium at install time that this image does not ship a browser for.
# Skipping it keeps the image small; /news simply stays unavailable, which the
# README already documents as best-effort.
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV NODE_ENV=production

WORKDIR /app

# Copy manifests first so the dependency layer is cached and only rebuilds when
# they change, not on every source edit.
COPY package.json package-lock.json ./

# `npm ci` installs exactly what the lockfile pins. --omit=dev drops eslint and
# prettier, which the running server does not need.
RUN npm ci --omit=dev

# Now the application code.
COPY . .

# Documents the port; the real value comes from Cloud Run via $PORT.
EXPOSE 8080

CMD ["node", "index.js"]
