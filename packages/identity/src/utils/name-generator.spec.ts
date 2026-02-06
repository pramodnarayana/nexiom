import { describe, it, expect } from "vitest";
import { generateFancyTenantName } from "./name-generator";

describe("NameGenerator", () => {
  it("generateFancyTenantName returns a 2-word string", () => {
    const name = generateFancyTenantName();
    expect(typeof name).toBe("string");
    expect(name.split(" ")).toHaveLength(2);
  });
});
