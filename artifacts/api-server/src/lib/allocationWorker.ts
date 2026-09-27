import { parentPort, workerData } from "node:worker_threads";
import {
  runPureAllocation,
  type PureAllocationInput,
} from "./allocationEngine.js";
import type { AllocationWorkerMessage } from "./allocationWorkerRuntime.js";

if (!parentPort)
  throw new Error("Allocation worker requires a parent message port");
const port = parentPort;
void runPureAllocation(workerData as PureAllocationInput)
  .then(
    (output) => {
      port.postMessage({ ok: true, output } satisfies AllocationWorkerMessage);
    },
    (error: unknown) => {
      const failure = error as Error & {
        code?: string;
        reason?: string;
        issues?: unknown;
      };
      port.postMessage({
        ok: false,
        error: {
          name: failure?.name ?? "Error",
          message: failure?.message ?? "Allocation worker failed",
          code: failure?.code,
          reason: failure?.reason,
          issues: failure?.issues,
        },
      } satisfies AllocationWorkerMessage);
    },
  )
  .finally(() => port.close());
