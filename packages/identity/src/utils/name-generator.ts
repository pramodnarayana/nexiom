import {
  uniqueNamesGenerator,
  adjectives,
  colors,
} from "unique-names-generator";

export function generateFancyTenantName(): string {
  const name = uniqueNamesGenerator({
    dictionaries: [adjectives, colors],
    separator: " ",
    length: 2,
    style: "capital",
  });
  return name; // Returns "Big Red", "Happy Blue", etc.
}
