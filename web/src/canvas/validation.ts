/** Small shape checks shared by the persisted data models. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
// Canvas policy: allow one million units in either direction, while keeping imported
// coordinates well below magnitudes that overflow relative-position arithmetic.
export const MAX_POSITION_COORDINATE = 1_000_000;
export const isPosition = (value: unknown): value is [number, number] =>
  Array.isArray(value) && value.length === 2
  && value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate)
    && Math.abs(coordinate) <= MAX_POSITION_COORDINATE);
export const hasStrings = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  keys.every((key) => typeof value[key] === "string");
export const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
export const isRecordList = (value: unknown, valid: (item: Record<string, unknown>) => boolean): boolean =>
  Array.isArray(value) && value.every((item) => isRecord(item) && valid(item));
