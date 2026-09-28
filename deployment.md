# Deployment

This project is prepared for a Cloudflare Wrangler deployment using a Cloudflare D1 SQLite database.

## Required setup

1. Install dependencies:
   - npm install
2. Create the D1 database:
   - npx wrangler d1 create student-academic-reporting-db
3. Update the `database_id` value in `wrangler.jsonc` to the created database ID.
4. Apply the schema to the D1 instance:
   - npx wrangler d1 migrations apply student-academic-reporting-db --local
   - npx wrangler d1 migrations apply student-academic-reporting-db
5. Set the app runtime secrets:
   - `AUTH_SECRET`
   - `SETUP_TOKEN`
6. Run the app locally with Wrangler when needed:
   - npm run wrangler:dev

## Environment variables

Use these values for your deployment environment:

- `AUTH_SECRET` — a long random secret used for session hashing
- `SETUP_TOKEN` — one-time bootstrap token for the first admin setup
- `NODE_ENV=production`
- `NEXT_TELEMETRY_DISABLED=1`

For local development, `DATABASE_URL` can point to a SQLite file such as `./.data/local.db`.

## Wrangler configuration

The project includes a D1 binding in `wrangler.jsonc`:

- binding: `DB`
- database_name: `student-academic-reporting-db`

This matches the code in `src/db/index.ts`, which prefers the Wrangler D1 binding and falls back to a local SQLite file when not running in Cloudflare.

## Deployment flow

1. Update the D1 database ID in `wrangler.jsonc`.
2. Run `npm install`.
3. Run `npm run build` if needed for the deployment target you are using.
4. Run `npm run wrangler:deploy`.
5. Open the app and complete the first-time setup flow.

## Notes

- This project uses SQLite/D1, not PostgreSQL.
- Keep all secrets out of version control.
- The app is compatible with Wrangler D1 and local SQLite development.
