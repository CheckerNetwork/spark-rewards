# syntax = docker/dockerfile:1

FROM node:20.13.1-slim AS base
LABEL fly_launch_runtime="NodeJS"
WORKDIR /app
ENV NODE_ENV=production

# Throw-away build stage to reduce size of final image
FROM base AS build
COPY --link package.json package-lock.json .
RUN npm install --production=false
COPY --link . .
RUN npm prune --production

# Final stage for app image
FROM base
COPY --from=build /app /app
CMD [ "npm", "run", "start" ]
