/** Small shape checks shared by the persisted data models. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const hasStrings = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  keys.every((key) => typeof value[key] === "string");
export const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
export const isRecordList = (value: unknown, valid: (item: Record<string, unknown>) => boolean): boolean =>
  Array.isArray(value) && value.every((item) => isRecord(item) && valid(item));
