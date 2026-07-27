import { bootstrapWorker } from "./bootstrap.js";

process.exitCode = await bootstrapWorker();
