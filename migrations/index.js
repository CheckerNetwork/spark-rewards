import Postgrator from 'postgrator'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const migrationsDirectory = dirname(fileURLToPath(import.meta.url))

export const migrate = async (/** @type {import("pg").Pool} */ client) => {
  const postgrator = new Postgrator({
    migrationPattern: join(migrationsDirectory, '*'),
    driver: 'pg',
    execQuery: (query) => client.query(query)
  })
  console.log(
    'Migrating DB schema from version %s to version %s',
    await postgrator.getDatabaseVersion(),
    await postgrator.getMaxVersion()
  )

  await postgrator.migrate()

  console.log('Migrated DB schema to version', await postgrator.getDatabaseVersion())
}
