# syntax = docker/dockerfile:1

FROM node:22.15.0-slim AS base
LABEL fly_launch_runtime="NodeJS"
WORKDIR /app
ENV NODE_ENV=production
ENV REQUEST_LOGGING=false

# Throw-away build stage to reduce size of final image
FROM base AS build
COPY --link package.json package-lock.json .
RUN npm install
COPY --link . .

# Final stage for app image
FROM base
COPY --from=build /app /app
CMD [ "npm", "run", "start" ]
