import { describe, expect, it } from "vitest";
import { parseModule } from "../../src/parser.js";
describe("Prisma compiler", () =>
  it("keeps schema files as graph modules", () =>
    expect(parseModule("model User { id Int @id }", "prisma/schema.prisma").parseStatus).toBe(
      "parsed",
    )));
