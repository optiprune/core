import test from "ava";
import { usedHelper } from "../helper.js";
test("default nested test", (t) => { t.is(usedHelper("nested"), "used:nested"); });
