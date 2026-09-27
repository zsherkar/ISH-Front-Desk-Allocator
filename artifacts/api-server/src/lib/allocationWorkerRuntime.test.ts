import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { runAllocationInWorker } from "./allocationWorkerRuntime.js";
import { createOverlapRegressionInput } from "./fixtures/allocationOverlap.js";

test(
  "HTTP health responses remain available throughout a monthly allocation worker",
  { timeout: 300_000 },
  async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200);
      response.end("healthy");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    let completed = false;
    const latencies: number[] = [];
    const input = createOverlapRegressionInput();
    const before = structuredClone(input);
    const started = Date.now();
    const baselineRss = process.memoryUsage().rss;
    let peakRss = baselineRss;
    const job = runAllocationInWorker(input).finally(() => {
      completed = true;
    });
    await assert.rejects(runAllocationInWorker(input), (error: unknown) => {
      const failure = error as Error & { code?: string; reason?: string };
      assert.equal(failure.code, "ALLOCATION_OPTIMIZATION_FAILED");
      assert.equal(
        failure.reason,
        "worker_busy_retry_after_current_allocation",
      );
      return true;
    });
    const monitor = (async () => {
      while (!completed) {
        peakRss = Math.max(peakRss, process.memoryUsage().rss);
        const began = Date.now();
        const response = await fetch(
          `http://127.0.0.1:${address.port}/api/healthz`,
          { signal: AbortSignal.timeout(2500) },
        );
        assert.equal(response.status, 200);
        assert.equal(await response.text(), "healthy");
        latencies.push(Date.now() - began);
        await delay(50);
      }
    })();
    try {
      const [output] = await Promise.all([job, monitor]);
      assert.deepEqual(input, before);
      assert.equal(output.assignments.length, 114);
      assert.equal(
        output.fairnessDiagnostics.optimizationMethod,
        "global_milp",
      );
      assert.ok(
        (output.fairnessDiagnostics.backToBackPairDays ?? Infinity) <= 12,
      );
      assert.ok(
        latencies.length >= 5,
        "health must respond repeatedly during computation, not only before/after it",
      );
      assert.ok(Math.max(...latencies) < 2500);
      console.log(
        JSON.stringify({
          workerElapsedMs: Date.now() - started,
          healthProbes: latencies.length,
          maximumHealthLatencyMs: Math.max(...latencies),
          rssMiB: process.memoryUsage().rss / 1024 / 1024,
          baselineRssMiB: baselineRss / 1024 / 1024,
          peakRssMiB: peakRss / 1024 / 1024,
          optimizerStatus: output.fairnessDiagnostics.optimizerStatus,
        }),
      );
    } finally {
      server.closeAllConnections();
      server.close();
    }
  },
);

test("worker preserves actionable optimization errors and the queue recovers", async () => {
  const input = createOverlapRegressionInput();
  input.allowExtremeNoAvailabilityAfpStacking = true;
  await assert.rejects(runAllocationInWorker(input), (error: unknown) => {
    const failure = error as Error & { code?: string; reason?: string };
    assert.equal(failure.name, "AllocationOptimizationError");
    assert.equal(failure.code, "ALLOCATION_OPTIMIZATION_FAILED");
    assert.match(
      failure.reason ?? "",
      /extreme_placeholder_stacking_not_supported/,
    );
    return true;
  });
  const output = await runAllocationInWorker({ shifts: [], respondents: [] });
  assert.deepEqual(output.assignments, []);
});
