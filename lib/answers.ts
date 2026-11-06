/** One spelling contract for board validation and player answer matching. */
export function normalizeAnswer(value: string): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ").trim().replace(/\s+/g, " ")
    .replace(/^(?:a|an|the) /, "")
    .split(" ").map((word) => word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word).join(" ");
}
