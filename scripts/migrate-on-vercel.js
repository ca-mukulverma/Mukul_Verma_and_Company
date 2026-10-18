// Applies pending database migrations during Vercel production builds, so
// nobody has to run `prisma migrate deploy` by hand. Preview builds and local
// builds skip it, so they never change the production database.
// If a migration fails, the build fails and the current deployment stays live.
const { execSync } = require("child_process");

// Migrations need a direct connection: Neon's pooled address (host with
// "-pooler") can't run them. DIRECT_URL is used when set; otherwise the
// direct address is DATABASE_URL with "-pooler" removed from the host.
// The app itself keeps using the pooled DATABASE_URL.
function directDatabaseUrl() {
  if (process.env.DIRECT_URL) return process.env.DIRECT_URL;
  const url = new URL(process.env.DATABASE_URL);
  url.hostname = url.hostname.replace("-pooler.", ".");
  url.searchParams.delete("pgbouncer");
  return url.toString();
}

if (require.main === module) {
  if (process.env.VERCEL_ENV === "production") {
    const directUrl = directDatabaseUrl();
    console.log(`Applying database migrations on ${new URL(directUrl).hostname} (prisma migrate deploy)...`);
    execSync("npx prisma migrate deploy", {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: directUrl },
    });
  } else {
    console.log("Skipping database migrations (not a Vercel production build)");
  }
}

module.exports = { directDatabaseUrl };
