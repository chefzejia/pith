/**
 * Declarative plugin settings schema and validator (inspired by magpie's
 * `internal/pluginrt/schema.go` and `kernel.js` `ui.form`).
 *
 * A plugin declares its settings schema once in its Manifest; the runtime
 * derives default values, validates user overrides from `plugins.yml`, and
 * drops invalid hand-edited values so the default stands.
 */

export type SettingFieldType = "boolean" | "integer" | "number" | "string";

export interface SettingFieldSpec {
  readonly type: SettingFieldType;
  readonly title: string;
  readonly description?: string;
  readonly default: boolean | number | string;
  readonly enum?: readonly (string | number)[];
  readonly minimum?: number;
  readonly maximum?: number;
}

export type SettingsSchema = Readonly<Record<string, SettingFieldSpec>>;

export interface ValidatedSettingsSchema {
  readonly order: readonly string[];
  readonly properties: SettingsSchema;
  readonly defaults: Readonly<Record<string, boolean | number | string>>;
  validateField(key: string, value: unknown): boolean;
  composeConfig(userConfig?: Readonly<Record<string, unknown>>): Record<string, boolean | number | string>;
}

export function compileSettingsSchema(pluginId: string, schema: SettingsSchema): ValidatedSettingsSchema {
  const order = Object.keys(schema);
  const defaults: Record<string, boolean | number | string> = {};

  for (const key of order) {
    const spec = schema[key]!;
    if (!spec.title.trim()) {
      throw new Error(`pluginrt: plugin "${pluginId}" setting "${key}" has an empty title`);
    }
    if (!isValidValue(spec, spec.default)) {
      throw new Error(
        `pluginrt: plugin "${pluginId}" setting "${key}" has a default (${JSON.stringify(spec.default)}) that violates its own schema`,
      );
    }
    defaults[key] = spec.default;
  }

  return {
    order,
    properties: schema,
    defaults,
    validateField(key: string, value: unknown): boolean {
      const spec = schema[key];
      if (!spec) return false;
      return isValidValue(spec, value);
    },
    composeConfig(userConfig?: Readonly<Record<string, unknown>>): Record<string, boolean | number | string> {
      const result: Record<string, boolean | number | string> = { ...defaults };
      if (!userConfig || typeof userConfig !== "object") return result;
      for (const key of order) {
        if (!(key in userConfig)) continue;
        const candidate = userConfig[key];
        if (isValidValue(schema[key]!, candidate)) {
          result[key] = candidate as boolean | number | string;
        }
      }
      return result;
    },
  };
}

function isValidValue(spec: SettingFieldSpec, value: unknown): boolean {
  if (spec.enum && spec.enum.length > 0) {
    if (!spec.enum.includes(value as string | number)) return false;
  }
  switch (spec.type) {
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string";
    case "integer":
      if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) return false;
      if (spec.minimum !== undefined && value < spec.minimum) return false;
      if (spec.maximum !== undefined && value > spec.maximum) return false;
      return true;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      if (spec.minimum !== undefined && value < spec.minimum) return false;
      if (spec.maximum !== undefined && value > spec.maximum) return false;
      return true;
    default:
      return false;
  }
}
