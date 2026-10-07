FROM node:22-bookworm AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm AS runtime
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl unzip ca-certificates wget \
  && wget -q https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb \
  && dpkg -i packages-microsoft-prod.deb \
  && apt-get update \
  && apt-get install -y --no-install-recommends powershell \
  && curl -fsSL -o /tmp/sqlite.nupkg https://www.nuget.org/api/v2/package/Stub.System.Data.SQLite.Core.NetStandard/1.0.119 \
  && mkdir -p /tmp/sqlite /opt/sqlite \
  && unzip -q /tmp/sqlite.nupkg -d /tmp/sqlite \
  && cp /tmp/sqlite/lib/netstandard2.1/System.Data.SQLite.dll /opt/sqlite/System.Data.SQLite.dll \
  && cp /tmp/sqlite/runtimes/linux-x64/native/SQLite.Interop.dll /opt/sqlite/SQLite.Interop.dll \
  && rm -rf /tmp/sqlite /tmp/sqlite.nupkg packages-microsoft-prod.deb /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
COPY --from=build /src/dist ./dist

ENV TAMSUN_BIND=+
ENV TAMSUN_PORT=8765
ENV TAMSUN_SQLITE_LIB=/opt/sqlite
EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8765/api/catalog >/dev/null || exit 1

CMD ["pwsh", "-NoProfile", "-File", "/app/server.ps1"]
