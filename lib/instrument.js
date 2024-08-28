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
  dsn: 'https://d99367ddbcbc76a09460139573932d66@o1408530.ingest.us.sentry.io/4507855648653312',
  release: pkg.version,
  environment: SENTRY_ENVIRONMENT,
  tracesSampleRate: 0.1
})
