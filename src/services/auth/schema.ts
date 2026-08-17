import { z } from 'zod';

export const AUTH_NAME_MAX_LENGTH = 40;

// eslint-disable-next-line no-control-regex -- deliberately matching control characters to reject them
const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/;

export const loginRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'name must not be blank')
    .max(AUTH_NAME_MAX_LENGTH, `name must be at most ${AUTH_NAME_MAX_LENGTH} characters`)
    .refine(
      (value) => !CONTROL_CHAR_PATTERN.test(value),
      'name must not contain control characters',
    ),
  password: z.string().min(1, 'password must not be blank'),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
