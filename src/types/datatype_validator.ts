import type { DataType, Data } from "./types.js";
import { assertJson } from "../dbms/value.js";

export function validateType(type: DataType, value: Data): boolean {
  switch (type) {
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "text":
      return typeof value === "string";
    case "jsonb":
      if (value === null || typeof value !== "object") return false;
      try {
        assertJson(value);
        return true;
      } catch {
        return false;
      }
    case "uuid":
      return (
        typeof value === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
      );
    case "date": {
      if (
        typeof value !== "string" ||
        !/^\d{4}(?:(?:0[1-9]|1[0-2])(?:(?:0[1-9]|[12]\d|3[01])(?:(?:[01]\d|2[0-3])(?:[0-5]\d(?:[0-5]\d(?:\.\d+)?)?)?)?)?)?$/.test(
          value,
        )
      )
        return false;
      if (value.length < 8) return true;
      const year = Number(value.slice(0, 4)),
        month = Number(value.slice(4, 6)),
        day = Number(value.slice(6, 8));
      const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    }
    case "time":
      return (
        typeof value === "string" &&
        /^(?:[01]\d|2[0-3])(?:[0-5]\d(?:[0-5]\d(?:\.\d+)?)?)?$/.test(value)
      );
    default:
      return false;
  }
}
