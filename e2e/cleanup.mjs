import { cleanup, guard } from "./lib.mjs";

guard();
const n = await cleanup();
console.log(`removed ${n} test team(s) and all test people (@tempo-e2e.test)`);
