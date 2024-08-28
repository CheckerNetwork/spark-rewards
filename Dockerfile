# syntax = docker/dockerfile:1

ARG NODE_VERSION=20.13.1
FROM node:${NODE_VERSION}-slim AS base
LABEL fly_launch_runtime="NodeJS"
WORKDIR /app
ENV NODE_ENV=production
FROM base AS build
RUN apt-get update -qq && \
    apt-get install -y python-is-python3 pkg-config build-essential
COPY --link package.json package-lock.json .
RUN npm install --production=false
COPY --link . .
RUN npm prune --production
FROM base
COPY --from=build /app /app
CMD [ "npm", "run", "start" ]