// How the API says no. Every refusal is an HttpError with a stable machine `code` (the
// browser app maps these to wording) and a plain-English `message` that is fine to show
// as-is. Validation failures also carry per-field messages so a form can mark the field.
import type { Context } from 'hono';
import { z } from 'zod';

export class HttpError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export function notFound(what = 'That record'): HttpError {
  return new HttpError(404, 'NOT_FOUND', `${what} was not found in this school.`);
}

export function forbidden(message = 'Your role in this school does not allow that.'): HttpError {
  return new HttpError(403, 'FORBIDDEN', message);
}

export function conflict(message: string, code = 'CONFLICT'): HttpError {
  return new HttpError(409, code, message);
}

export function invalid(message: string, fields?: Record<string, string>): HttpError {
  return new HttpError(400, 'INVALID', message, fields);
}

/** Validates `data` against `schema`, turning Zod's issues into one HttpError with per-field messages. */
export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  const first = Object.entries(fields)[0];
  throw invalid(first ? `${first[0] === '_' ? '' : `${first[0]}: `}${first[1]}` : 'Check the form and try again.', fields);
}

export async function readBody<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> {
  let data: unknown;
  try {
    data = await c.req.json();
  } catch {
    throw invalid('The request body was not valid JSON.');
  }
  return parse(schema, data);
}

export function readQuery<T extends z.ZodTypeAny>(c: Context, schema: T): z.infer<T> {
  return parse(schema, c.req.query());
}

// ---- small shared validators ----

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-04-01.');
export const optionalText = z
  .string()
  .trim()
  .max(500)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));
export const requiredText = (label: string, max = 200) =>
  z.string({ required_error: `${label} is required.` }).trim().min(1, `${label} is required.`).max(max);

/** Indian mobile numbers, accepted with or without +91, spaces or dashes; stored as ten digits. */
export const phone = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (!v) return null;
    const digits = v.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
    if (!/^\d{10}$/.test(digits)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a 10-digit mobile number.' });
      return z.NEVER;
    }
    return digits;
  });

export const email = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (!v) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid email address.' });
      return z.NEVER;
    }
    return v.toLowerCase();
  });

/** Rupee amounts arrive as paise integers from the browser. */
export const paise = z.number().int('Amounts are in whole paise.').min(0).max(1_000_000_000);
