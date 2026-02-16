FROM node:24-alpine

WORKDIR /app
COPY .yarnrc.yml package.json yarn.lock tsconfig.json ./
COPY src ./src

RUN corepack enable && \
    yarn --immutable && \
    yarn build && \
    yarn cache clean && \
    ln -s /app/dist/cli.js /usr/bin/config-cli

ENTRYPOINT ["/usr/bin/config-cli"]
