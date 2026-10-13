/** Existing suites test business contracts with the policy collaborator isolated.
 * call-policy.spec.ts does not import this double: it exercises real protection.
 */
import { vi } from 'vitest'
vi.mock('../src/call-policy.ts', async importOriginal => {
  const original = await importOriginal<typeof import('../src/call-policy.ts')>()
  return { ...original, withZhihuCallPolicy: async (_path: string, _body: unknown, _quota: unknown, execute: () => Promise<unknown>) => execute() }
})
