/** Describes a single validation failure for a specific trade input. */
export interface CgValidationDetail {
  /** Zero-based index of the invalid trade in the input array. */
  index: number;
  /** Name of the invalid field. */
  field: string;
  /** Human-readable error message. */
  message: string;
}

/** Thrown when trade inputs fail validation. Contains details for all invalid trades. */
export class CgValidationError extends Error {
  readonly errors: CgValidationDetail[];
  constructor(errors: CgValidationDetail[]) {
    super(`Validation failed: ${errors.length} error(s)`);
    this.name = "CgValidationError";
    this.errors = errors;
  }
}
