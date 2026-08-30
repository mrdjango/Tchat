# Tchat gateway broker.
#
# Zero runtime dependencies, so there is no install step and nothing to audit
# beyond the Node base image and the sources in src/.
FROM node:24.16.0-alpine

USER root
RUN apk add --no-cache curl gnupg \
    && curl -Ls --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh | sh \
    && doppler --version
RUN mkdir -p /app && chown node:node /app
WORKDIR /app

COPY entrypoint.sh /usr/local/bin/tchat-entrypoint
RUN chmod 0755 /usr/local/bin/tchat-entrypoint

USER node
COPY --chown=node:node broker/package.json ./
COPY --chown=node:node broker/src ./src

EXPOSE 8081
ENTRYPOINT ["tchat-entrypoint"]
CMD ["node", "src/server.js"]
