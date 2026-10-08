import assert from "node:assert/strict";
import { mustRetryThroughPipeline as f } from "./pipelineRetryRouting";

const lead = (o: Partial<Parameters<typeof f>[0]>) => ({ enrichmentStatus: "COMPLETE", flags: [] as string[], onHoldReason: null, ...o });

assert.equal(f(lead({ enrichmentStatus: "STALLED" })), true, "stalled -> pipeline");
assert.equal(f(lead({ enrichmentStatus: "PENDING", flags: ["ON_HOLD"], onHoldReason: "SYSTEM_ERROR" })), true, "system error -> pipeline");
assert.equal(f(lead({ enrichmentStatus: "PENDING", flags: ["ON_HOLD"], onHoldReason: "TIMEOUT" })), true, "timeout -> pipeline");
assert.equal(f(lead({})), false, "healthy enriched lead may use Autumn");
assert.equal(f(lead({ flags: ["ON_HOLD"], onHoldReason: "MANUAL" })), false, "manual hold may use Autumn");
// a stale reason without the hold flag must not block Autumn
assert.equal(f(lead({ onHoldReason: "SYSTEM_ERROR" })), false, "reason without ON_HOLD flag is not a hold");
console.log("pipelineRetryRouting: all assertions passed");
