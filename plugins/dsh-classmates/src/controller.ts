import { type Context } from '@deepseek-ai/cordis';
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { BindingStore } from './bindings.js';
import { RoleConfig } from './config.js';
import { readTeamDetails } from './team-info.js';

declare module '@deepseek-ai/cordis' {
  interface Context {
    classmatesController: ClassmatesController;
  }
}

export class ClassmatesController extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly roles: RoleConfig,
    private readonly store?: BindingStore,
  ) {
    super(ctx, 'classmatesController', { namespace: 'classmates' });
  }

  @Remote
  async load() { return this.roles.load(); }

  @Remote
  async save(role: unknown, expected: number) {
    try { return await this.roles.save(role, expected); }
    catch (cause) { throw new RemoteError('gateway/bad-request', cause instanceof Error ? cause.message : String(cause), {}); }
  }

  @Remote('deleteRole')
  async remove(id: string, revision: number, expected: number) {
    try { return await this.roles.remove(id, revision, expected); }
    catch (cause) { throw new RemoteError('gateway/bad-request', cause instanceof Error ? cause.message : String(cause), {}); }
  }

  @Remote
  async batch(changes: unknown, expected: number) {
    try { return await this.roles.batch(changes, expected); }
    catch (cause) { throw new RemoteError('gateway/bad-request', cause instanceof Error ? cause.message : String(cause), {}); }
  }

  @Remote
  async saveModelProfile(profile: unknown, expected: number) {
    try { return await this.roles.saveModelProfile(profile, expected); }
    catch (cause) { throw new RemoteError('gateway/bad-request', cause instanceof Error ? cause.message : String(cause), {}); }
  }

  @Remote('deleteModelProfile')
  async removeModelProfile(id: string, revision: number, expected: number) {
    try { return await this.roles.removeModelProfile(id, revision, expected); }
    catch (cause) { throw new RemoteError('gateway/bad-request', cause instanceof Error ? cause.message : String(cause), {}); }
  }

  @Remote
  async batchModelProfiles(changes: unknown, expected: number) {
    try { return await this.roles.batchModelProfiles(changes, expected); }
    catch (cause) { throw new RemoteError('gateway/bad-request', cause instanceof Error ? cause.message : String(cause), {}); }
  }

  @Remote
  async setModelProtection(model: unknown, required: boolean, expected: number) {
    try { return await this.roles.setModelProtection(model, required, expected); }
    catch (cause) { throw new RemoteError('gateway/bad-request', cause instanceof Error ? cause.message : String(cause), {}); }
  }

  @Remote
  async team(leadId: string) {
    try { return await readTeamDetails(this.ctx, leadId, this.store); }
    catch (cause) { throw new RemoteError('gateway/bad-request', cause instanceof Error ? cause.message : String(cause), {}); }
  }
}
