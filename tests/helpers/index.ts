import type { ShapecraftModel } from "../../src/types.js";
import { SchemaViolationError } from "../../src/types.js";

export function mockModel(returnValue: unknown, shouldFail = false): ShapecraftModel {
  return {
    id: "mock:test",
    guaranteeLevel: "constrained",
    async generate<T>(): Promise<T> {
      if (shouldFail) throw new SchemaViolationError("bad", "invalid");
      return returnValue as T;
    },
  };
}

export function mockModelThatFails(): ShapecraftModel {
  return {
    id: "mock:test",
    guaranteeLevel: "constrained",
    async generate<T>(): Promise<T> {
      throw new SchemaViolationError("bad output", "invalid");
    },
  };
}
