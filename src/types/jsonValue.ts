export type JsonPrimitive = string | number | boolean | null;

export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonArray = Array<JsonValue>;

export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
