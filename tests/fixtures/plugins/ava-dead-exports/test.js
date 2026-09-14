import test from "ava";
import { foo } from "./helper.js";
test("only foo is used", (t) => { t.is(foo(), "foo"); });
