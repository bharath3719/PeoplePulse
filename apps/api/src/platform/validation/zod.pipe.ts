import { Body, BadRequestException, type PipeTransform, Injectable } from '@nestjs/common';
import { ZodError, type ZodSchema } from 'zod';

/**
 * Validate at the edge, with the SAME zod schema the web client uses.
 *
 * The schema is the contract, written once (ENGINEERING-STANDARDS.md §5). A
 * field's rules cannot drift between client and server, because there is only
 * one statement of them.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    try {
      return this.schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        throw validationFailed(error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })));
      }
      throw error;
    }
  }
}

export interface FieldError {
  field: string;
  message: string;
}

/**
 * RFC 7807-shaped (TR-40). Field-level, so the UI can attach each message to the
 * input that caused it. Also thrown by services, for the rules a schema cannot
 * check — "that department belongs to another company".
 */
export function validationFailed(errors: FieldError[]): BadRequestException {
  return new BadRequestException({
    type: 'https://peoplepulse.in/errors/validation',
    title: 'Validation failed',
    errors,
  });
}

/** @ZodBody(schema) — validated and typed in one annotation. */
export const ZodBody = (schema: ZodSchema) => Body(new ZodValidationPipe(schema));
