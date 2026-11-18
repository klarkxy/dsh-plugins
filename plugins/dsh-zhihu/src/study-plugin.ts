import type { Context } from '@deepseek-ai/cordis'
import { ZHIHU_STUDY_SKILLS, type ZhihuStudySkill } from './study-skill.ts'

export const name = 'dsh-zhihu-study'
export const inject = ['skills'] as const

/** Skill routes stay optional for the tool bundle: if the host has no skills service, retrieval and export still register. */
export function apply(ctx: Context): void {
  const skills = (ctx as Context & { skills: { register(skill: ZhihuStudySkill): () => void } }).skills
  for (const skill of ZHIHU_STUDY_SKILLS) ctx.effect(() => skills.register(skill))
}
