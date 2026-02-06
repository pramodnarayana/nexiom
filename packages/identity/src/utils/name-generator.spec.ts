import { describe, it, expect } from "vitest";
import { generateFancyTenantName } from "./name-generator";

describe("NameGenerator", () => {
  it("generateFancyTenantName returns a 2-word string", () => {
    const name = generateFancyTenantName();
    expect(name).toBeTypeOf("string");
    // Expect Two Words, Capitalized. e.g. "Workable Santa"
    expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });
});
