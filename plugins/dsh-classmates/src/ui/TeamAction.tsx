/**
 * Enhanced Agent Teams conversation-header action, adapted from
 * @deepseek-ai/dsh-experimental-client-ui-agent-team (MIT License,
 * Copyright (c) DeepSeek). The roster, task board, dismissal, positioning,
 * keyboard, and navigation behavior mirror the official TeamAction; Classmates
 * metadata (frozen role name, configured vs. last-used model, per-member
 * issues) augments the official roster rows without replacing them, and the
 * task board renders the official projection verbatim.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  IconChevronDownOutlineRegular,
  IconUserOutlineRegular,
  IconUsersOutlineRegular,
  StateDot,
  Tag,
  Tooltip,
  useAnchoredPosition,
  useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives';
import type { ModelBinding, TeamDetails, TeamIdentity } from '../contracts.js';
import {
  createTeamMetadataLoader,
  currentRunningRefreshKey,
  lastUsedFingerprint,
  resolveModelProvenance,
  rosterRunningRefreshKey,
  shouldLoadTeamMetadata,
} from './team-metadata.js';
import type { ClassmatesTeamKey, TeamTranslate } from './team-locales.js';
import { classmatesTeamCss } from './team-styles.js';

/** Minimal structural views over the host Session stores (selectors only). */
interface SessionSnapshotLike {
  openState?: string;
  subagent?: { address: { parentSessionId?: string } } | null;
}

interface TeamMemberLike {
  id: string;
  name: string;
  role: 'lead' | 'teammate';
  phase: 'provisioning' | 'active' | 'failed';
  error?: string;
}

interface TeamTaskLike {
  id: string;
  revision: number;
  subject: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'deleted';
  blockedBy: string[];
  writeScopes: string[];
  ownerName?: string;
  ready: boolean;
  writeScopeWarnings: string[];
}

interface TeamProjectionLike {
  members: readonly TeamMemberLike[];
  tasks: readonly TeamTaskLike[];
  failure?: string;
}

interface SessionListLike {
  phase?: string;
  byId: Record<string, { running?: boolean } | undefined>;
  projectionsBySession: Readonly<Record<string, {
    values: {
      agentTeam?: TeamProjectionLike;
      modelSelection?: {
        lastUsed: { provider: string; model: string; reasoningEffort?: string } | null;
      };
    };
  } | undefined>>;
}

interface SessionStatusLike {
  running?: boolean;
}

export interface UseSessionLike {
  <T>(selector: (snapshot: SessionSnapshotLike) => T): T;
}

export interface UseSessionsLike {
  <T>(selector: (snapshot: SessionListLike) => T, equal?: (left: T, right: T) => boolean): T;
}

export interface UseSessionStatusLike {
  <T>(selector: (snapshot: ReadonlyMap<string, SessionStatusLike>) => T): T;
}

export interface ClassmatesTeamActionProps {
  sessionId: string;
  useSession: UseSessionLike;
  useSessions: UseSessionsLike;
  useSessionStatus: UseSessionStatusLike;
  /** Open a roster Session from the current conversation (native navigation). */
  openTeammate: (sessionId: string, childSessionId: string) => void;
  /** Read-only Classmates metadata for the Lead's roster. */
  fetchTeam: (leadId: string) => Promise<TeamDetails>;
  t: TeamTranslate;
}

function statusKey(status: TeamTaskLike['status']): ClassmatesTeamKey {
  switch (status) {
    case 'pending': return 'status.pending';
    case 'in_progress': return 'status.in_progress';
    case 'completed': return 'status.completed';
    // Team views omit deleted task tombstones.
    case 'deleted': return 'status.completed';
  }
}

function memberStatusKey(status: 'running' | 'inactive' | 'provisioning' | 'failed'): ClassmatesTeamKey {
  switch (status) {
    case 'running': return 'memberStatus.running';
    case 'inactive': return 'memberStatus.inactive';
    case 'provisioning': return 'memberStatus.provisioning';
    case 'failed': return 'memberStatus.failed';
  }
}

function memberDotState(status: 'running' | 'inactive' | 'provisioning' | 'failed') {
  switch (status) {
    case 'running':
    case 'provisioning': return 'ongoing' as const;
    case 'failed': return 'error' as const;
    case 'inactive': return 'idle' as const;
  }
}

function taskDotState(task: TeamTaskLike) {
  switch (task.status) {
    case 'pending': return task.ready ? ('idle' as const) : ('warning' as const);
    case 'in_progress': return 'ongoing' as const;
    case 'completed': return 'done' as const;
    // Team views omit deleted task tombstones.
    case 'deleted': return 'idle' as const;
  }
}

function formatBinding(binding: ModelBinding): string {
  return binding.reasoningEffort
    ? `${binding.provider}/${binding.id} · ${binding.reasoningEffort}`
    : `${binding.provider}/${binding.id}`;
}

/** Role-friendly label plus the stable instance name; duplicates stay distinguishable. */
function displayName(member: TeamMemberLike, identity: TeamIdentity | undefined): string {
  return identity?.roleName ? `${identity.roleName} · ${member.name}` : member.name;
}

interface TeamMemberRowProps {
  member: TeamMemberLike;
  identity: TeamIdentity | undefined;
  /** Tasks this member currently owns (derived from the official board). */
  ownedTasks: TeamTaskLike[];
  memberCount: number;
  sessionId: string;
  useSessions: UseSessionsLike;
  useSessionStatus: UseSessionStatusLike;
  openTeammate: (sessionId: string, childSessionId: string) => void;
  onError: (message: string) => void;
  t: TeamTranslate;
}

function TeamMemberRow({
  member,
  identity,
  ownedTasks,
  memberCount,
  sessionId,
  useSessions,
  useSessionStatus,
  openTeammate,
  onError,
  t,
}: TeamMemberRowProps) {
  const running = useSessionStatus(state => state.get(member.id)?.running);
  const summaryRunning = useSessions(state => state.byId[member.id]?.running);
  const status = member.phase === 'active'
    ? ((running ?? summaryRunning) === true ? 'running' : 'inactive')
    : member.phase;
  const isCurrent = member.id === sessionId;
  const highlightCurrent = isCurrent && memberCount > 1;
  const inert = isCurrent || status === 'failed' || status === 'provisioning';
  const primaryName = identity?.roleName ?? (member.role === 'lead' ? t('lead') : member.name);
  // The stable instance name rides its own secondary line whenever the
  // primary label is a friendlier display name.
  const showInstance = primaryName !== member.name;
  // Actual last request wins; the configured binding shows only as 已配置,
  // never as actual. A member with neither is explicitly unknown — the
  // configured next selection never masquerades as last used.
  const provenance = identity?.lastUsedModel
    ? `${t('lastUsed')}: ${formatBinding(identity.lastUsedModel)}`
    : identity?.configuredModel
      ? `${t('configured')}: ${formatBinding(identity.configuredModel)}`
      : identity !== undefined
        ? t('modelUnknown')
        : undefined;
  return (
    <Tooltip label={t('open')} side="bottom" gap={4} disabled={inert}>
      <button
        type="button"
        className={highlightCurrent ? 'cmt-member cmt-memberCurrent' : 'cmt-member'}
        disabled={inert}
        onClick={() => {
          try {
            openTeammate(sessionId, member.id);
          } catch (reason) {
            onError(String(reason));
          }
        }}
      >
        <span className="cmt-memberDot">
          {status === 'inactive'
            ? <IconUserOutlineRegular size={14} className="cmt-inactiveIcon" />
            : <StateDot state={memberDotState(status)} />}
        </span>
        <span className="cmt-memberText">
          <span className="cmt-memberName">
            <span className="cmt-memberNameText">{primaryName}</span>
            {isCurrent && (
              <Tag tone="info" className="cmt-currentTag">{t('current')}</Tag>
            )}
          </span>
          {showInstance && (
            <small>{member.name}</small>
          )}
          <small>
            {t(memberStatusKey(status))}
            {provenance !== undefined && ` · ${provenance}`}
          </small>
          {ownedTasks.length > 0 && (
            <small>
              {t('memberTasks')}: {ownedTasks[0].subject}
              {ownedTasks.length > 1 && `（+${ownedTasks.length - 1}）`}
            </small>
          )}
          {identity?.issue !== undefined && (
            <small className="cmt-issue">{identity.issue}</small>
          )}
          {member.error !== undefined && (
            <small className="cmt-diagnostic">{member.error}</small>
          )}
        </span>
      </button>
    </Tooltip>
  );
}

interface TaskCardProps {
  task: TeamTaskLike;
  /** Role-friendly owner label mapped from Classmates metadata, when known. */
  ownerDisplay?: string | undefined;
  t: TeamTranslate;
}

/** Task card with a two-line description clamp expanded from a toggle in the meta row. */
function TaskCard({ task, ownerDisplay, t }: TaskCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    if (expanded) return;
    const paragraph = textRef.current;
    if (paragraph === null) return;
    const measure = () => {
      setClamped(paragraph.scrollHeight > paragraph.clientHeight + 1);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(paragraph);
    return () => {
      observer.disconnect();
    };
  }, [task.description, expanded]);
  return (
    <article className="cmt-task">
      <div className="cmt-taskTitle">
        <strong>{task.subject}</strong>
        <span className="cmt-taskState">
          <StateDot state={taskDotState(task)} />
          <span>{t(statusKey(task.status))}</span>
        </span>
      </div>
      <p ref={textRef} className={expanded ? undefined : 'cmt-clampedDescription'}>
        {task.description}
      </p>
      <div className="cmt-meta">
        {(clamped || expanded) && (
          <button
            type="button"
            className="cmt-expandToggle"
            aria-expanded={expanded}
            onClick={() => {
              setExpanded(current => !current);
            }}
          >
            {t(expanded ? 'task.collapse' : 'task.expand')}
            <IconChevronDownOutlineRegular size={12} className={expanded ? 'cmt-expandToggleOpen' : undefined} />
          </button>
        )}
        <span>{task.id}</span>
        <span>{t('owner')}: {ownerDisplay ?? task.ownerName ?? t('unowned')}</span>
        {task.status === 'pending' && (
          <span>{task.ready ? t('ready') : t('blocked')}</span>
        )}
        {task.blockedBy.length > 0 && (
          <span>{t('blockedBy')}: {task.blockedBy.join(', ')}</span>
        )}
        {task.writeScopes.length > 0 && (
          <span>{t('writeScopes')}: {task.writeScopes.join(', ')}</span>
        )}
        {task.writeScopeWarnings.map(warning => (
          <span key={warning} className="cmt-warning">{warning}</span>
        ))}
      </div>
    </article>
  );
}

/** Render the Team roster and read-only task board with Classmates identity. */
export function ClassmatesTeamAction({
  sessionId,
  useSession,
  useSessions,
  useSessionStatus,
  openTeammate,
  fetchTeam,
  t,
}: ClassmatesTeamActionProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const triggerLabelRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const position = useAnchoredPosition({ open, anchorRef: triggerRef, panelRef, gap: 5, margin: 16 });
  const positioned = position !== null;
  const leadSessionId = useSession(snapshot => snapshot.subagent?.address.parentSessionId) ?? sessionId;
  const team = useSessions(state => state.projectionsBySession[leadSessionId]?.values.agentTeam);
  const opening = useSession(snapshot => snapshot.openState === 'loading');
  const listing = useSessions(state => state.phase === 'pending');
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pinnedRef = useRef(false);

  const [details, setDetails] = useState<TeamDetails | null>(null);
  const [metadataFailed, setMetadataFailed] = useState(false);
  const rosterKey = team === undefined ? '' : team.members.map(member => member.id).join(' ');
  const isMember = team?.members.some(member => member.id === sessionId) ?? false;
  const lastUsedKey = useSessions(state => lastUsedFingerprint(state.projectionsBySession[sessionId]?.values.modelSelection));
  const rosterLastUsedKey = useSessions(state => {
    if (!open || team === undefined) return '';
    return team.members.map(member => lastUsedFingerprint(state.projectionsBySession[member.id]?.values.modelSelection)).join('\n');
  });
  const currentRunning = useSessionStatus(state => currentRunningRefreshKey(state.get(sessionId)?.running));
  const rosterRunningKey = useSessionStatus(state => rosterRunningRefreshKey(
    open,
    team?.members.map(member => member.id),
    id => state.get(id)?.running,
  ));

  const cancelHoverChange = () => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = undefined;
  };

  useEffect(() => {
    cancelHoverChange();
    pinnedRef.current = false;
    setOpen(false);
    setError(null);
    setDetails(null);
    setMetadataFailed(false);
  }, [sessionId]);

  useEffect(() => cancelHoverChange, []);

  // Metadata follows official request/projection changes for the current
  // session (and roster last-used while the panel is open). Generation and
  // sequence drop stale sessions and out-of-order replies; unmount disposes.
  const loaderRef = useRef<ReturnType<typeof createTeamMetadataLoader> | undefined>(undefined);
  useEffect(() => {
    const loader = createTeamMetadataLoader(result => {
      setDetails(result.details);
      setMetadataFailed(result.failed);
    });
    loaderRef.current = loader;
    loader.resetSession(sessionId);
    return () => {
      loader.dispose();
      loaderRef.current = undefined;
    };
  }, [sessionId, fetchTeam]);

  useEffect(() => {
    if (!shouldLoadTeamMetadata(open, isMember)) return;
    loaderRef.current?.refresh(sessionId, leadSessionId, fetchTeam);
  }, [open, isMember, sessionId, leadSessionId, rosterKey, lastUsedKey, rosterLastUsedKey, currentRunning, rosterRunningKey, fetchTeam]);

  useLayoutEffect(() => {
    if (open && positioned && pinnedRef.current) panelRef.current?.focus();
  }, [open, positioned]);

  const changeOpen = (next: boolean) => {
    cancelHoverChange();
    if (!next) pinnedRef.current = false;
    setOpen(next);
  };

  const scheduleHoverOpen = () => {
    cancelHoverChange();
    if (open) return;
    const label = triggerLabelRef.current;
    if (label === null) return;
    if (getComputedStyle(label).display === 'none') return;
    hoverTimer.current = setTimeout(() => {
      hoverTimer.current = undefined;
      changeOpen(true);
    }, 150);
  };

  const scheduleHoverClose = () => {
    cancelHoverChange();
    if (pinnedRef.current) return;
    hoverTimer.current = setTimeout(() => {
      hoverTimer.current = undefined;
      changeOpen(false);
    }, 120);
  };

  useDismissOnOutsidePointer(rootRef, open, changeOpen, panelRef);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancelHoverChange();
      pinnedRef.current = false;
      setOpen(false);
      if (panelRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
    };
    document.addEventListener('keydown', dismiss);
    return () => {
      document.removeEventListener('keydown', dismiss);
    };
  }, [open]);

  const compact = team !== undefined && team.members.length === 1 && team.tasks.length === 0;
  const identityOf = (memberId: string) => details?.members.find(entry => entry.memberId === memberId);
  // Official owner names map back to role + stable instance when metadata knows them.
  const ownerDisplayOf = (ownerName: string | undefined) => {
    if (ownerName === undefined) return undefined;
    const identity = details?.members.find(entry => entry.memberName === ownerName);
    return identity?.roleName ? `${identity.roleName} · ${identity.memberName}` : undefined;
  };
  // Owned, not-yet-completed tasks from the official board; nothing is
  // invented from member status.
  const ownedTasksOf = (member: TeamMemberLike) =>
    team === undefined
      ? []
      : team.tasks.filter(task =>
          task.ownerName === member.name && task.status !== 'completed' && task.status !== 'deleted');
  const currentMember = team?.members.find(member => member.id === sessionId);
  const currentIdentity = currentMember ? identityOf(currentMember.id) : undefined;
  const provenance = resolveModelProvenance(currentIdentity);
  const lastUsed = provenance.kind === 'lastUsed' ? provenance.binding : null;
  const configured = provenance.kind === 'configured' ? provenance.binding : null;
  // Concise header identity: role + model id. Configured-only is explicitly
  // marked so it never masquerades as the actual last request; the panel
  // holds the full instance and provider details.
  const headerModel = lastUsed
    ? ` · ${lastUsed.id}`
    : configured
      ? ` · ${configured.id} · ${t('configured')}`
      : '';
  const triggerText = currentMember
    ? currentMember.role === 'lead' && currentIdentity?.roleName === undefined
      ? `${t('trigger')} · ${t('lead')}`
      : `${currentIdentity?.roleName ?? currentMember.name}${headerModel}`
    : t('trigger');
  const ariaText = currentMember
    ? `${t('trigger')} · ${displayName(currentMember, currentIdentity)}${
        lastUsed ? ` · ${t('lastUsed')} ${formatBinding(lastUsed)}`
          : configured ? ` · ${t('configured')} ${formatBinding(configured)}`
            : ''}`
    : t('trigger');

  return (
    <div ref={rootRef} className="cmt-root" data-team-action="true" onMouseLeave={scheduleHoverClose}>
      <style>{classmatesTeamCss}</style>
      <button
        type="button"
        ref={triggerRef}
        onMouseEnter={scheduleHoverOpen}
        className="cmt-trigger"
        aria-label={ariaText}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          cancelHoverChange();
          pinnedRef.current = true;
          if (!open) changeOpen(true);
          else panelRef.current?.focus();
        }}
      >
        <IconUsersOutlineRegular size={14} />
        <span ref={triggerLabelRef} className="cmt-triggerLabel">{triggerText}</span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className={compact ? 'cmt-panel cmt-panelCompact' : 'cmt-panel'}
          style={position ?? { visibility: 'hidden', left: 0, top: 0 }}
          role="dialog"
          tabIndex={-1}
          aria-label={t('trigger')}
          data-team-panel="true"
          onMouseEnter={cancelHoverChange}
          onMouseLeave={scheduleHoverClose}
        >
          <div className="cmt-body">
            {error !== null && (
              <div className="cmt-error" role="alert">
                <StateDot state="error" />
                {error}
              </div>
            )}
            {team === undefined && (
              <div className="cmt-notice" role="status">
                <StateDot state={opening || listing ? 'ongoing' : 'warning'} />
                {t(opening || listing ? 'loading' : 'unavailable')}
              </div>
            )}
            {team !== undefined && (
              <>
                {team.failure !== undefined && (
                  <div className="cmt-error" role="alert">
                    <StateDot state="error" />
                    {t('failure', { message: team.failure })}
                  </div>
                )}
                <section>
                  <h3>
                    {t('roster')}
                    {team.members.length > 1 && (
                      <span className="cmt-count">{team.members.length}</span>
                    )}
                  </h3>
                  {metadataFailed && (
                    <p className="cmt-emptyNotice" role="status">{t('metadataError')}</p>
                  )}
                  <div className="cmt-roster">
                    {team.members.map(member => (
                      <TeamMemberRow
                        key={member.id}
                        member={member}
                        identity={identityOf(member.id)}
                        ownedTasks={ownedTasksOf(member)}
                        memberCount={team.members.length}
                        sessionId={sessionId}
                        useSessions={useSessions}
                        useSessionStatus={useSessionStatus}
                        openTeammate={openTeammate}
                        onError={setError}
                        t={t}
                      />
                    ))}
                  </div>
                </section>
                <section>
                  {team.tasks.length === 0 ? (
                    <p className="cmt-emptyNotice">{t('empty')}</p>
                  ) : (
                    <>
                      <h3>
                        {t('tasks')}
                        <span className="cmt-count">{team.tasks.length}</span>
                      </h3>
                      <div className="cmt-tasks">
                        {team.tasks.map(task => (
                          <TaskCard key={task.id} task={task} ownerDisplay={ownerDisplayOf(task.ownerName)} t={t} />
                        ))}
                      </div>
                    </>
                  )}
                </section>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
