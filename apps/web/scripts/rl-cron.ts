import { runDailyRlTraining } from "../lib/rl/training";

async function main() {
  const startedAt = new Date().toISOString();
  const result = await runDailyRlTraining();

  console.log(
    JSON.stringify(
      {
        startedAt,
        finishedAt: new Date().toISOString(),
        ...result
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("rl-cron failed", error);
  process.exit(1);
});
