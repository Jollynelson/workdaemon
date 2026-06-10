-- Fix: cannot delete users from auth.users
-- Four FKs reference auth.users(id) with no ON DELETE rule (defaults to NO ACTION/RESTRICT),
-- which blocks deleting any user that owns a workspace, is on a task, or sent an invite.
-- Switch them to ON DELETE SET NULL so the user can be removed without destroying their data.
-- Run in the Supabase SQL Editor (workdaemon-prod project).

-- workspaces.owner_id
alter table public.workspaces
  drop constraint if exists workspaces_owner_id_fkey,
  add  constraint workspaces_owner_id_fkey
    foreign key (owner_id) references auth.users(id) on delete set null;

-- tasks.assignee_id
alter table public.tasks
  drop constraint if exists tasks_assignee_id_fkey,
  add  constraint tasks_assignee_id_fkey
    foreign key (assignee_id) references auth.users(id) on delete set null;

-- tasks.created_by
alter table public.tasks
  drop constraint if exists tasks_created_by_fkey,
  add  constraint tasks_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

-- workspace_invites.invited_by
alter table public.workspace_invites
  drop constraint if exists workspace_invites_invited_by_fkey,
  add  constraint workspace_invites_invited_by_fkey
    foreign key (invited_by) references auth.users(id) on delete set null;
