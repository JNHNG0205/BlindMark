// RFC 8785 JSON Canonicalization Scheme. Spec: CLAUDE.md section 5.2.
//
// JCS serializes numbers exactly as ECMAScript's Number.prototype.toString, so JSON.stringify
// already gives the right text for primitives; only key order and rejection rules are added here.
// For example 1e-6 serializes as "0.000001".

/** Canonical JSON text. Throws on values JSON cannot represent (NaN, Infinity, undefined, ...). */
export function canonicalize(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("JCS: non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    // Sort by UTF-16 code units, which is the default string comparison in JS.
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  throw new Error(`JCS: unsupported value of type ${typeof value}`);
}
