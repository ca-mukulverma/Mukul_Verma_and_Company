// Applies pending database migrations during Vercel production builds, so
// nobody has to run `prisma migrate deploy` by hand. Preview builds and local
// builds skip it, so they never change the production database.
// If a migration fails, the build fails and the current deployment stays live.
const { execSync } = require("child_process");

if (process.env.VERCEL_ENV === "production") {
  console.log("Applying database migrations (prisma migrate deploy)...");
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
} else {
  console.log("Skipping database migrations (not a Vercel production build)");
}
