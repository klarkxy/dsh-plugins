/**
 * Classmates Team panel dictionaries. Core roster/task keys mirror the
 * official agent-team namespace so the shadowed panel reads identically;
 * Classmates additions cover role identity and model provenance.
 */

export const CLASSMATES_TEAM_NS = 'classmates';

export type ClassmatesTeamKey =
  | 'trigger'
  | 'loading'
  | 'unavailable'
  | 'failure'
  | 'empty'
  | 'roster'
  | 'tasks'
  | 'model'
  | 'open'
  | 'current'
  | 'lead'
  | 'owner'
  | 'unowned'
  | 'blockedBy'
  | 'writeScopes'
  | 'ready'
  | 'blocked'
  | 'task.expand'
  | 'task.collapse'
  | 'memberStatus.running'
  | 'memberStatus.inactive'
  | 'memberStatus.provisioning'
  | 'memberStatus.failed'
  | 'status.pending'
  | 'status.in_progress'
  | 'status.completed'
  | 'configured'
  | 'lastUsed'
  | 'modelUnknown'
  | 'memberTasks'
  | 'metadataError'

export type TeamTranslate = (key: ClassmatesTeamKey, params?: Record<string, unknown>) => string;

export const classmatesTeamZh: Record<ClassmatesTeamKey, string> = {
  trigger: '智能体团队',
  loading: '正在加载团队…',
  unavailable: 'Team 暂不可用',
  failure: '团队持久记录无效：{message}',
  empty: '暂无共享任务，可以通过对话创建',
  roster: '成员',
  tasks: '共享任务',
  model: '模型',
  open: '打开成员会话',
  current: '当前会话',
  lead: '主控',
  owner: '负责人',
  unowned: '未分配',
  blockedBy: '依赖',
  writeScopes: '写入范围',
  ready: '可开始',
  blocked: '被依赖阻塞',
  'task.expand': '展开',
  'task.collapse': '收起',
  'memberStatus.running': '运行中',
  'memberStatus.inactive': '空闲',
  'memberStatus.provisioning': '准备中',
  'memberStatus.failed': '失败',
  'status.pending': '待处理',
  'status.in_progress': '进行中',
  'status.completed': '已完成',
  configured: '已配置',
  lastUsed: '上次使用',
  modelUnknown: '模型未知',
  memberTasks: '任务',
  metadataError: '角色详情加载失败，正在显示团队成员列表',
};

export const classmatesTeamEn: Record<ClassmatesTeamKey, string> = {
  trigger: 'Agent Team',
  loading: 'Loading Team…',
  unavailable: 'Team is unavailable',
  failure: 'Invalid persisted Team record: {message}',
  empty: 'No shared tasks yet. Create them through the conversation.',
  roster: 'Members',
  tasks: 'Shared tasks',
  model: 'Model',
  open: 'Open member conversation',
  current: 'Current chat',
  lead: 'Lead',
  owner: 'Owner',
  unowned: 'Unowned',
  blockedBy: 'Blocked by',
  writeScopes: 'Write scopes',
  ready: 'Ready',
  blocked: 'Blocked by dependencies',
  'task.expand': 'Show more',
  'task.collapse': 'Show less',
  'memberStatus.running': 'Running',
  'memberStatus.inactive': 'Idle',
  'memberStatus.provisioning': 'Provisioning',
  'memberStatus.failed': 'Failed',
  'status.pending': 'Pending',
  'status.in_progress': 'In progress',
  'status.completed': 'Completed',
  configured: 'Configured',
  lastUsed: 'Last used',
  modelUnknown: 'Model unknown',
  memberTasks: 'Tasks',
  metadataError: 'Could not load role details. Showing the team member list.',
};
