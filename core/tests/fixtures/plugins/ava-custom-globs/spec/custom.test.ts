import test from "ava";
import { customHelper } from "../src/custom-helper.js";
test("custom glob entry", (t) => { t.is(customHelper(), "custom"); });
