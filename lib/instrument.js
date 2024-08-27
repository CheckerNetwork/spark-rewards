import * as Sentry from '@sentry/node'
import fs from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const { SENTRY_ENVIRONMENT = 'development' } = process.env

const pkg = JSON.parse(
  await fs.readFile(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'package.json'
    ),
    'utf8'
  )
)

Sentry.init({
  dsn: 'FIXME',
  release: pkg.version,
  environment: SENTRY_ENVIRONMENT,
  tracesSampleRate: 0.1
})
