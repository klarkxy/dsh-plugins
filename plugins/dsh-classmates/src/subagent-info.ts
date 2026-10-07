import type { SubagentBinding } from './bindings.js';
import type { ModelProfile, NormalizedRole, SubagentIdentity } from './contracts.js';
import { templateStatusOf } from './contracts.js';

interface RoleLibrary {
  roles: readonly NormalizedRole[];
  profiles: readonly ModelProfile[];
}

/**
 * Assemble one classmates.subagents row from a frozen subagent binding.
 * `library` is absent when settings are unreadable; the status fields are
 * then omitted rather than guessed.
 */
export function subagentRow(binding: SubagentBinding, library?: RoleLibrary): SubagentIdentity {
  const row: SubagentIdentity = {
    childId: binding.childId,
    roleId: binding.role.id,
    roleName: binding.role.name,
    roleRevision: binding.role.revision,
    roleDescription: binding.role.description,
    modelSource: binding.modelSource,
    createdAt: binding.createdAt,
  };
  if (binding.modelProfileId !== undefined) {
    row.modelProfileId = binding.modelProfileId;
    const profileName = library?.profiles.find(profile => profile.id === binding.modelProfileId)?.name;
    if (profileName) row.modelProfileName = profileName;
  }
  if (binding.model !== undefined) row.configuredModel = binding.model;
  if (library) {
    const status = templateStatusOf({ id: binding.role.id, name: binding.role.name }, library.roles);
    row.templateStatus = status.templateStatus;
    if (status.currentRoleName !== undefined) row.currentRoleName = status.currentRoleName;
  }
  return row;
}
