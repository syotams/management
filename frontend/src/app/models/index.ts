export interface User {
  id: string;
  email: string;
  name: string;
  timezone?: string;
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

export interface Team {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
  members?: TeamMember[];
}

export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  role: string;
  user: User;
}

export interface TeamInvite {
  id: string;
  teamId: string;
  email: string;
  token: string;
  status: string;
  expiresAt: string;
  inviteLink: string | null;
  daysUntilExpiry: number;
}

export interface AssignableMember {
  id: string;
  name: string;
  email: string;
  teamId: string;
  teamName: string;
}

export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskStatus = 'todo' | 'in_progress' | 'completed' | 'archived';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  dueDate: string;
  priority: Priority;
  status: TaskStatus;
  ownerId: string;
  assigneeId: string;
  teamId: string | null;
  createdBy: string;
  alertAt: string;
  alertSent: boolean;
  createdAt: string;
  updatedAt: string;
  owner: User;
  assignee: User;
  lastComment?: Comment | null;
}

export interface Comment {
  id: string;
  taskId: string;
  userId: string;
  body: string;
  createdAt: string;
  user: User;
}

export interface AuditLog {
  id: string;
  taskId: string;
  userId: string;
  action: string;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
  user: User;
}

export interface TaskDetail extends Task {
  comments: Comment[];
  history: AuditLog[];
}

export interface DayGroup {
  key: string;
  label: string;
  isOverdue: boolean;
  tasks: Task[];
}

export interface GroupedTasks {
  urgent: Task[];
  groups: DayGroup[];
}

export type QuarterStatus = 'draft' | 'in_progress' | 'completed';

export interface QuarterSummary {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  teamId: string | null;
  status: QuarterStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  team: { id: string; name: string } | null;
  _count: { sprints: number; epics: number; versions?: number };
}

export interface QuarterSprint {
  id: string;
  number: number;
  startDate: string;
  endDate: string;
  workingDays: number;
}

export interface EpicChip {
  epicId: string;
  title: string;
  backgroundColor: string;
  daysInSprint: number;
}

export interface QuarterParticipant {
  id: string;
  name: string;
  email: string;
  cells: Record<string, EpicChip[]>;
}

export interface QuarterEpic {
  id: string;
  groupKey: string | null;
  sourceEpicId: string | null;
  title: string;
  workingDays: number;
  startSprintNumber: number | null;
  backgroundColor: string;
  createdAt: string;
  assignees: User[];
}

export interface QuarterPlanView {
  name: string;
  startDate: string;
  endDate: string;
  teamId: string | null;
  team: { id: string; name: string } | null;
  sprints: QuarterSprint[];
  participants: QuarterParticipant[];
  epics: QuarterEpic[];
}

export interface QuarterComparison {
  original: QuarterPlanView;
  latest: QuarterPlanView;
  originalVersion: number;
  latestVersion: number;
  stats: ComparisonStats;
}

export interface ComparisonStats {
  unchangedCount: number;
  changedCount: number;
  addedCount: number;
  removedCount: number;
  originalTotalWorkingDays: number;
  latestTotalWorkingDays: number;
  workingDaysDiff: number;
  extendedEpicCount: number;
  unchangedEpics: ComparisonEpicEntry[];
  changedEpics: ComparisonEpicEntry[];
}

export interface ComparisonEpicEntry {
  id: string;
  title: string;
  assignee: string | null;
  workingDays: number;
  startSprintNumber: number | null;
  status: 'unchanged' | 'changed' | 'added' | 'removed';
  changes: string[];
}

export interface QuarterDetail {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  teamId: string | null;
  status: QuarterStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  team: { id: string; name: string } | null;
  teams: { id: string; name: string }[];
  addedParticipants: User[];
  versionCount: number;
  currentVersion: number | null;
  sprints: QuarterSprint[];
  participants: QuarterParticipant[];
  epics: QuarterEpic[];
}
