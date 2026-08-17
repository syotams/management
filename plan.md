# Updated Plan — Decisions Locked In

Your four answers are incorporated below. They affect grouping, alerts, team removal, and invites.

---

## Decisions Summary

| # | Decision | Implementation |
|---|----------|----------------|
| 1 | Overdue tasks | Separate **Overdue** section above **Today** |
| 2 | Alerts | User-configurable **alert datetime** per task (not fixed to due time) |
| 3 | Removed member's tasks | Tasks **stay with assignee**; no auto-reassign |
| 4 | Invite expiry | Links expire after **5 days** |

---

## 1. Overdue Section

**Grouping order (top → bottom):**

```
Overdue — past due dates
Today — Saturday, Aug 15, 2026
Tomorrow — Sunday, Aug 16, 2026
Monday, Aug 17, 2026
...
```

**Rules**

- Task is overdue when `dueDate < now` and `status IN (todo, in_progress)`.
- Overdue section uses distinct styling (e.g. red/warning header, subtle row highlight).
- Within Overdue: sort by priority (high → medium → low), then oldest due date first.
- Drag-and-drop: owner can drag **from** Overdue **to** a future day group → updates `dueDate`, task leaves Overdue.
- Completed/archived tasks never appear in Overdue.

```typescript
function groupTasks(tasks: Task[]): DayGroup[] {
  const overdue = tasks.filter(t => isPast(t.dueDate) && isActive(t.status));
  const upcoming  = tasks.filter(t => !isPast(t.dueDate) && isActive(t.status));

  const groups: DayGroup[] = [];
  if (overdue.length) groups.push({ label: 'Overdue', tasks: sortByPriority(overdue) });
  groups.push(...groupByDay(upcoming, /* today first */));
  return groups;
}
```

---

## 2. Configurable Alert Time

Each task has a user-set **`alertAt`** datetime, independent of `dueDate`.

**Defaults on create**

| Field | Default |
|-------|---------|
| `dueDate` | Today (existing time or end of day — pick one at build time) |
| `alertAt` | Same as `dueDate` unless user sets otherwise |

**UI**

- Inline add: optional **Alert** datetime field (collapsed by default).
- Task detail: editable **Alert at** field.
- Postpone modal: option **"Also update alert"** (checked by default) — shifts `alertAt` by the same delta, or user sets alert separately.

**Validation**

- `alertAt` can be before, at, or after `dueDate` (user choice).
- If `alertAt` is in the past on save, show warning; still allow save.

**Scheduler behavior**

```
Every minute:
  Find tasks WHERE alertAt <= now AND alertSent = false AND status IN (todo, in_progress)
  → Send email to assignee (+ optionally owner)
  → Trigger browser notification (via polling endpoint)
  → Set alertSent = true
```

**API fields**

```typescript
Task {
  // ...
  dueDate:   DateTime
  alertAt:   DateTime    // user-configurable
  alertSent: boolean     // reset to false when alertAt changes
}
```

When `alertAt` is updated → `alertSent = false` so a new alert fires.

---

## 3. Removed Member — Tasks Unchanged

When an owner removes a member from a team:

| What | Behavior |
|------|----------|
| Existing tasks where removed user is **assignee** | **Unchanged** — assignee keeps the task |
| Existing tasks where removed user is **owner** | **Unchanged** — owner keeps ownership |
| Task visibility | Owner and assignee still see the task (unchanged rule) |
| New task assignment | Removed user **no longer appears** in team member picker |
| Team association | `teamId` on existing tasks can remain; task is not deleted or modified |

**Remove member API**

```typescript
DELETE /teams/:id/members/:userId
// Only removes TeamMember row
// Does NOT touch Task.assigneeId or Task.ownerId
```

**Edge case:** If assignee was only reachable via that team, they still see and can act on assigned tasks after removal.

---

## 4. Invite Expiry — 5 Days

**Model update**

```typescript
TeamInvite {
  // ...
  token:     string
  status:    'pending' | 'accepted' | 'expired'
  expiresAt: DateTime    // createdAt + 5 days
  createdAt: DateTime
}
```

**Rules**

- On create: `expiresAt = createdAt + 5 days`.
- Accept endpoint: reject with `410 Gone` if `now > expiresAt` → set `status = 'expired'`.
- Members list: pending invites show **"Expires in X days"** or **"Expired"**.
- Expired invites: link copy disabled; owner can **"Re-invite"** (new token, new 5-day window).
- Optional cron: mark pending invites as `expired` when `expiresAt` passes.

**Members list UI (pending invite row)**

```
bob@co.com | Pending | Expires in 3 days | [Copy link] [Resend] [Revoke]
```

Expired:

```
bob@co.com | Expired | [Re-invite]
```

---

## Updated Data Model (final)

```typescript
User {
  id, email (unique), passwordHash, createdAt
}

Team { id, name, createdBy, createdAt }

TeamMember {
  id, teamId, userId, role: 'owner' | 'member', joinedAt
}

TeamInvite {
  id, teamId, email, token, status, invitedBy,
  createdAt, expiresAt   // createdAt + 5 days
}

Task {
  id, title, description?, dueDate, priority, status,
  ownerId, assigneeId, teamId?, createdBy,
  alertAt,              // user-configurable alert datetime
  alertSent,
  createdAt, updatedAt
}

Comment { id, taskId, userId, body, createdAt }

TaskAuditLog {
  id, taskId, userId, action, fieldName?, oldValue?, newValue?, createdAt
}
```

---

## Updated List View Layout

```
┌─ Overdue ─────────────────────────────────────────────────────┐
│ [red header]                                                  │
│  HIGH | Fix prod bug | In Progress | Aug 14 | ... | [actions]│
└───────────────────────────────────────────────────────────────┘

┌─ Today — Saturday, Aug 15, 2026 ──────────────────────────────┐
│  MED  | Review PR      | Todo        | Aug 15 | ... | [actions]│
└───────────────────────────────────────────────────────────────┘

┌─ Tomorrow — Sunday, Aug 16, 2026 ─────────────────────────────┐
│  LOW  | Deploy         | Todo        | Aug 16 | ... | [actions]│
└───────────────────────────────────────────────────────────────┘
```

Columns unchanged: Priority, Title, Status, Due Date, Created at, Assignee, Last comment, Actions.

---

## Updated Permissions (unchanged from v3)

| Action | Owner | Assignee |
|--------|:-----:|:--------:|
| Start / Complete / Archive | ✓ | ✓ |
| Comment | ✓ | ✓ |
| Change due date (postpone / drag) | ✓ | ✗ |
| Set / change alert time | ✓ | ✗* |

\*Recommend owner-only for alert time, same as due date — say if assignee should also set alerts.

---

## Updated Implementation Phases

### Phase 1 — Auth
Register (unique email) + login + JWT

### Phase 2 — Teams
Create team, invite with 5-day expiry, visible copy link, remove member (tasks untouched)

### Phase 3 — Tasks core
CRUD, owner/assignee, grouped list with **Overdue section**, inline add, actions

### Phase 4 — Comments & history
Comments + last comment column + audit log

### Phase 5 — DnD, alerts, polish
Owner-only drag-and-drop, configurable `alertAt`, email + browser notifications

---

All open decisions from the plan are now resolved. Say which phase to implement first when you want to start building.
