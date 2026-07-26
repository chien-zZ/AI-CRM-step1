import { describe, expect, it } from "vitest";

import { compileSchema } from "./validation.js";

const validator = (format: "date" | "date-time") => compileSchema({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  additionalProperties: false,
  properties: { value: { format, type: "string" } },
  required: ["value"],
  type: "object",
});

describe("strict Gregorian form formats", () => {
  it("accepts real dates and leap days only", () => {
    const validate = validator("date");
    expect(validate({ value: "2024-02-29" })).toBe(true);
    for (const value of ["2026-02-29", "2026-04-31", "2026-00-10", "2026-13-01"]) expect(validate({ value })).toBe(false);
  });

  it("rejects nonexistent dates and 24-hour rollover timestamps", () => {
    const validate = validator("date-time");
    expect(validate({ value: "2024-02-29T23:59:59.999Z" })).toBe(true);
    for (const value of ["2026-04-31T00:00:00Z", "2026-01-01T24:00:00Z", "2026-01-01T23:60:00Z", "2026-01-01T23:59:60Z"]) expect(validate({ value })).toBe(false);
  });
});
