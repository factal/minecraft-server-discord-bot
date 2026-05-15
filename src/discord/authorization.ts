import type { GuildMemberRoleManager } from 'discord.js'

import type { AppConfig } from '../config/schema'

export type AuthorizationPolicy = { kind: 'public' } | { kind: 'admin' }

export interface AuthorizableInteraction {
  guildId: string | null
  member: {
    roles?: GuildMemberRoleManager | string[] | null
  } | null
  user: {
    id: string
  }
}

export type AuthorizationResult = { ok: true } | { ok: false; reason: string }

export function extractRoleIds(member: AuthorizableInteraction['member']): string[] {
  if (!member?.roles) {
    return []
  }

  if (Array.isArray(member.roles)) {
    return member.roles
  }

  return Array.from(member.roles.cache.keys())
}

export function authorizeInteraction(
  interaction: AuthorizableInteraction,
  policy: AuthorizationPolicy,
  config: AppConfig,
): AuthorizationResult {
  if (policy.kind === 'public') {
    return { ok: true }
  }

  if (!interaction.guildId) {
    return { ok: false, reason: 'This command can only be used inside the configured guild.' }
  }

  if (config.discord.allowedUserIds.includes(interaction.user.id)) {
    return { ok: true }
  }

  const interactionRoleIds = extractRoleIds(interaction.member)
  const hasAllowedRole = interactionRoleIds.some((roleId) =>
    config.discord.adminRoleIds.includes(roleId),
  )

  if (hasAllowedRole) {
    return { ok: true }
  }

  if (config.discord.adminRoleIds.length === 0 && config.discord.allowedUserIds.length === 0) {
    return { ok: false, reason: 'No admin role or user allowlist is configured.' }
  }

  return { ok: false, reason: 'User is not in an allowed admin role.' }
}
