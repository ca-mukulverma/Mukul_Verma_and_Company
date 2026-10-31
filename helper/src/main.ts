import { CancelledError, OfficeApi } from "./api";
import { isActiveTime, loadConfig, sleep } from "./config";
import { runJob } from "./run-job";

// The GST portal helper (docs/GST_PORTAL_DOWNLOADS.md). During the active
// days and hours it asks the office app for a job every POLL_SECONDS, runs
// it, and looks for the next one at once. Outside those hours it sleeps
// without calling the app, so the database can sleep too.
//   npm start        keep running
//   npm run once     run one job (if any) and stop
// Ctrl+C finishes the current job first; press it again to stop at once.

const once = process.argv.includes("--once");
const config = loadConfig();
const api = new OfficeApi(config.appUrl, config.helperKey);

let stopping = false;
let busy = false;
process.on("SIGINT", () => {
  if (!busy || stopping) {
    console.log("\nStopped.");
    process.exit(busy ? 130 : 0);
  }
  stopping = true;
  console.log("\nFinishing the current job, then stopping. Press Ctrl+C again to stop now.");
});

const time = () => new Date().toLocaleString("en-IN");

async function main() {
  console.log(`GST portal helper "${config.helperName}" for ${config.appUrl}`);
  let sleepingNoted = false;
  while (!stopping) {
    if (!once && !isActiveTime(config)) {
      if (!sleepingNoted) console.log(`${time()}: outside the active hours, sleeping`);
      sleepingNoted = true;
      await sleep(60_000);
      continue;
    }
    sleepingNoted = false;

    let job;
    try {
      ({ job } = await api.claim(config.helperName));
    } catch (error) {
      console.error(`${time()}: could not reach the office app: ${error instanceof Error ? error.message : error}`);
      if (once) process.exitCode = 1;
      if (once) return;
      await sleep(config.pollSeconds * 1000);
      continue;
    }

    if (!job) {
      if (once) {
        console.log("No job is queued.");
        return;
      }
      await sleep(config.pollSeconds * 1000);
      continue;
    }

    console.log(`${time()}: job for ${job.client.name} (${job.client.gstin}): ${job.returns.join(", ")} · ${job.formats.join(", ")} · ${job.months.join(", ")}`);
    busy = true;
    try {
      const outcome = await runJob(job, { api, config });
      console.log(`${time()}: ${job.client.name}: ${outcome}`);
    } catch (error) {
      if (!(error instanceof CancelledError)) console.error(`${time()}: ${job.client.name}: ${error instanceof Error ? error.stack : error}`);
    } finally {
      busy = false;
    }
    if (once) return;
    // Look for the next job at once
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
