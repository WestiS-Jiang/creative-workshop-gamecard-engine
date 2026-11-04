import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "../contracts/game-state.schema.json";
import type { GameState } from "../contracts/game-state";

const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true
});
addFormats(ajv);

const validate = ajv.compile(schema) as ValidateFunction<GameState>;

export function validateGameState(payload: unknown): {
  valid: boolean;
  errors: string[];
} {
  const valid = validate(payload);
  if (valid) {
    return {
      valid: true,
      errors: []
    };
  }

  return {
    valid: false,
    errors: (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`)
  };
}
