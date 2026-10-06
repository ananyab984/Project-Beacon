/**
 * Run: cd server && npx ts-node src/prisma.test.ts
 */

import assert from "node:assert";
import { withConnectionPool } from "./prisma";

assert.strictEqual(withConnectionPool("postgresql://u:p@h/db"), "postgresql://u:p@h/db?connection_limit=20&pool_timeout=20");
assert.strictEqual(withConnectionPool("postgresql://u:p@h/db?sslmode=require"), "postgresql://u:p@h/db?sslmode=require&connection_limit=20&pool_timeout=20");
assert.strictEqual(withConnectionPool("postgresql://u:p@h/db?connection_limit=5"), "postgresql://u:p@h/db?connection_limit=5", "an explicit pool wins");
assert.strictEqual(withConnectionPool(undefined), undefined);
console.log("all 4 passed");
process.exit(0);
