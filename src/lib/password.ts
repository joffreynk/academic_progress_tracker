export const PASSWORD_RULE_TEXT =
  'At least 6 characters with an uppercase letter, a lowercase letter, a number and a symbol.';

export function passwordProblem(value: string): string | null {
  if (value.length < 6) return 'Password must be at least 6 characters.';
  if (!/[A-Z]/.test(value)) return 'Password must contain an uppercase letter.';
  if (!/[a-z]/.test(value)) return 'Password must contain a lowercase letter.';
  if (!/[0-9]/.test(value)) return 'Password must contain a number.';
  if (!/[^A-Za-z0-9]/.test(value)) return 'Password must contain a symbol.';
  return null;
}

export function isStrongPassword(value: string): boolean {
  return passwordProblem(value) === null;
}
