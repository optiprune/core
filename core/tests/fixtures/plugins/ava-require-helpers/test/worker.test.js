import test from "ava";
test("required setup is live", (t) => { t.is(globalThis.__avaFixtureSetup, "ready"); });
