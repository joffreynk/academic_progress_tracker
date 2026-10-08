import assert from 'node:assert';
import test from 'node:test';
import { PASSWORD_RULE_TEXT, passwordProblem, isStrongPassword } from '../src/lib/password';
import { generateStrongPassword, passwordSchema } from '../src/lib/passwordSchema';

test('password rule: length first, then uppercase, lowercase, number and symbol', () => {
  assert.equal(passwordProblem('Abc1!'), 'Password must be at least 6 characters.');
  assert.equal(passwordProblem('abcdef'), 'Password must contain an uppercase letter.');
  assert.equal(passwordProblem('ABCDEF'), 'Password must contain a lowercase letter.');
  assert.equal(passwordProblem('abcdef1'), 'Password must contain an uppercase letter.');
  assert.equal(passwordProblem('Abcdef1'), 'Password must contain a symbol.');
  assert.equal(passwordProblem('Abcdef!'), 'Password must contain a number.');
  assert.equal(passwordProblem('Abc1!x'), null);
  assert.ok(isStrongPassword('Abc1!x') && !isStrongPassword('Abcdef1'));
  assert.match(PASSWORD_RULE_TEXT, /6 characters/);
});

test('password schema: accepts compliant values and explains the failure otherwise', () => {
  assert.ok(passwordSchema.safeParse('Abc1!x').success);
  const weak = passwordSchema.safeParse('abcdef');
  assert.ok(!weak.success);
  assert.equal(weak.error?.issues[0]?.message, 'Password must contain an uppercase letter.');
});

test('generated passwords satisfy the rule and start with an alphanumeric character', () => {
  for (let i = 0; i < 200; i += 1) {
    const password = generateStrongPassword();
    assert.ok(password.length >= 6, `generated password too short: ${password}`);
    assert.match(password, /^[A-Za-z0-9]/, 'generated password must start alphanumeric for CSV safety');
    assert.equal(passwordProblem(password), null, `generated password violates the rule: ${password}`);
  }
});
