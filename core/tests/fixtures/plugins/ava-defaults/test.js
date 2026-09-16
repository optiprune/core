import test from "ava";
import { usedHelper } from "./helper.js";
test("default root test", (t) => { t.is(usedHelper("default"), "used:default"); });
