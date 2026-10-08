import { randomBytes } from 'crypto';
import { z } from 'zod';
import { passwordProblem } from './password';

export const passwordSchema = z.string().superRefine((value, ctx) => {
  const problem = passwordProblem(value);
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
});

/** URL-safe secret that never starts with a formula trigger and always satisfies the password rule. */
export function generateStrongPassword(): string {
  let password = '';
  do {
    password = randomBytes(18).toString('base64url');
  } while (!/^[A-Za-z0-9]/.test(password) || passwordProblem(password) !== null);
  return password;
}

/**
 * Deliberately small first password handed to imported teachers so they can sign in on any
 * device; every teacher replaces it with a strong password from Change Password afterwards.
 * Override with TEACHER_INITIAL_PASSWORD when deploying.
 */
export function initialTeacherPassword(): string {
  return (process.env.TEACHER_INITIAL_PASSWORD || '').trim() || 'school123';
}
