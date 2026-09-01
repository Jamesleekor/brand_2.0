import { z } from 'zod';

export const TestFixturePasswordSchema = z.string()
  .min(6, 'TEST 계정 비밀번호는 6자 이상이어야 합니다.')
  .max(128, 'TEST 계정 비밀번호는 128자 이하여야 합니다.');

export const TestFixtureReconcileInputSchema = z.object({
  initialPassword: TestFixturePasswordSchema,
});
export type TestFixtureReconcileInput = z.infer<typeof TestFixtureReconcileInputSchema>;

export const TestFixturePasswordResetInputSchema = z.object({
  newPassword: TestFixturePasswordSchema,
});
export type TestFixturePasswordResetInput = z.infer<typeof TestFixturePasswordResetInputSchema>;

