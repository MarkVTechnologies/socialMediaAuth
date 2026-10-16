export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.WORKER_ENABLED === "false") return;
  const { startWorker } = await import("./lib/scheduler");
  startWorker(Number(process.env.WORKER_INTERVAL_MS || 15000));
}
