// Purpose of this file is to do a validation on each of the db-thing data types
import { DataType, Data } from "./types";

export function validateType(type: DataType, value: Data): boolean {
  switch (type) {
    case "boolean":
      if (typeof value === "boolean") {
        return true;
      } else {
        return false;
      }
    case "number":
      if (typeof value === "number") {
        return true;
      } else {
        return false;
      }
    case "text":
      if (typeof value === "string") {
        return true;
      } else {
        return false;
      }
    case "jsonb":
      if (typeof value === "object") {
        return true;
      } else {
        return false;
      }
    case "uuid":
      const uuidV4Regex =
        /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\b/;
      if (typeof value === "string" && !uuidV4Regex.test(value)) {
        return true;
      } else {
        return false;
      }
    case "date":
      if (typeof value === "string") {
        const validDateRegex = new RegExp(
          "^" +
            "(?:" +
            "(?:\\d{4})" + // YYYY
            "(?:" +
            "(?:0[1-9]|1[0-2])" + // MM (01–12)
            "(?:" +
            "(?:0[1-9]|[12]\\d|3[01])" + // DD (01–31)
            "(?:" +
            "(?:[01]\\d|2[0-3])" + // hh (00–23)
            "(?:" +
            "[0-5]\\d" + // mm (00–59)
            "(?:" +
            "[0-5]\\d(?:\\.\\d+)?" + // ss (00–59, optional decimal)
            ")?" +
            ")?" +
            ")?" +
            ")?" +
            ")?" +
            ")$",
        );
        return validDateRegex.test(value);
      } else {
        return false;
      }
    case "time":
      if (typeof value === "string") {
        const validTimeRegex = new RegExp(
          "^" +
            "(?:[01]\\d|2[0-3])" + // hours 00–23
            "(?:" +
            "[0-5]\\d" + // minutes 00–59
            "(?:" +
            "[0-5]\\d(?:\\.\\d+)?" + // seconds 00–59 + optional fraction
            ")?" +
            ")?" +
            "$",
        );
        return validTimeRegex.test(value);
      } else {
        return false;
      }
    default:
      return false;
  }
}
