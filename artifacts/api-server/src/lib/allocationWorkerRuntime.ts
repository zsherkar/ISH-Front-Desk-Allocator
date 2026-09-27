import path from "node:path";
import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type {
  PureAllocationInput,
  PureAllocationOutput,
} from "./allocationEngine.js";
import {
  assertValidAllocationInput,
  assertValidAllocationResult,
} from "./allocationValidation.js";

interface WorkerFailure {
  name: string;
  message: string;
  code?: string;
  reason?: string;
  issues?: unknown;
}
export type AllocationWorkerMessage =
  | { ok: true; output: PureAllocationOutput }
  | { ok: false; error: WorkerFailure };

const JOB_TIMEOUT_MS = 300_000;
const MAX_PENDING_JOBS = 1;
let pendingJobs = 0;
let queue: Promise<void> = Promise.resolve();

function runtimeFailure(
  reason: string,
): Error & { code: string; reason: string } {
  return Object.assign(
    new Error(
      `The allocator could not finish safely (${reason}). Your saved allocation has not been changed.`,
    ),
    {
      name: "AllocationOptimizationError",
      code: "ALLOCATION_OPTIMIZATION_FAILED",
      reason,
    },
  );
}

function executeWorker(
  input: PureAllocationInput,
): Promise<PureAllocationOutput> {
  // Production ships a CJS sibling entry. Source runs explicitly register tsx
  // inside the worker because Node's native TS loader does not remap .js imports.
  const bundled = typeof __filename === "string" && __filename.endsWith(".cjs");
  const sourceEntry =
    typeof __filename === "string"
      ? pathToFileURL(path.join(__dirname, "allocationWorker.ts"))
      : new URL("./allocationWorker.ts", import.meta.url);
  const workerEntry = bundled
    ? path.join(__dirname, "allocationWorker.cjs")
    : `require(${JSON.stringify(createRequire(sourceEntry).resolve("tsx/esm/api"))}).register(); import(${JSON.stringify(sourceEntry.href)});`;
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(workerEntry, {
        workerData: input,
        execArgv: [],
        eval: !bundled,
        resourceLimits: { maxOldGenerationSizeMb: 128 },
      });
    } catch {
      reject(runtimeFailure("worker_start_failed"));
      return;
    }
    let finished = false;
    const finish = (error?: Error, output?: PureAllocationOutput) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      worker.removeAllListeners();
      // Releasing the worker also releases its WASM heap before the next job.
      void worker.terminate().then(
        () => {
          if (error) reject(error);
          else resolve(output!);
        },
        () => reject(runtimeFailure("worker_termination_failed")),
      );
    };
    const deadline = setTimeout(
      () => finish(runtimeFailure("worker_deadline_exceeded")),
      JOB_TIMEOUT_MS,
    );
    worker.once("message", (message: AllocationWorkerMessage) => {
      if (message?.ok === true) {
        try {
          assertValidAllocationResult(input, message.output);
          finish(undefined, message.output);
        } catch (error) {
          finish(
            error instanceof Error
              ? error
              : runtimeFailure("worker_result_invalid"),
          );
        }
      } else if (
        message?.ok === false &&
        message.error &&
        typeof message.error.message === "string"
      ) {
        const failure = message.error;
        finish(
          Object.assign(new Error(failure.message), {
            name: failure.name,
            code: failure.code,
            reason: failure.reason,
            issues: failure.issues,
          }),
        );
      } else finish(runtimeFailure("worker_message_invalid"));
    });
    worker.once("error", () => finish(runtimeFailure("worker_failed")));
    worker.once("exit", () =>
      finish(runtimeFailure("worker_exited_without_result")),
    );
  });
}

/** Keep synchronous solver CPU work away from HTTP/health-check handling. */
export async function runAllocationInWorker(
  input: PureAllocationInput,
): Promise<PureAllocationOutput> {
  assertValidAllocationInput(input);
  if (pendingJobs >= MAX_PENDING_JOBS)
    throw runtimeFailure("worker_busy_retry_after_current_allocation");
  const snapshot = structuredClone(input);
  pendingJobs += 1;
  const job = queue.then(() => executeWorker(snapshot));
  queue = job.then(
    () => undefined,
    () => undefined,
  );
  try {
    return await job;
  } finally {
    pendingJobs -= 1;
  }
}
