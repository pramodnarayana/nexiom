import {
  uniqueNamesGenerator,
  adjectives,
  colors,
  animals,
} from "unique-names-generator";

export function generateFancyTenantName(): string {
  const name = uniqueNamesGenerator({
    dictionaries: [adjectives, colors, animals],
    separator: " ",
    length: 2,
    style: "capital",
  });
  return name; // Returns "Big Red", "Happy Blue", etc.
}
