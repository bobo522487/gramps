'use client';

import { Check, Loader2, PlusCircle, Trash2 } from 'lucide-react';
import { useActionState } from 'react';
import { EmptyState } from '@/components/console/empty-state';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ActionState } from '@/lib/auth/types';
import {
  inviteOrgMember,
  removeOrgMember,
  updateOrgMemberRole,
} from '@/lib/org/actions';
import { roleLabel, roleVariant } from '@/lib/ui/status';

export type MemberView = {
  id: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
};

function displayName(member: MemberView) {
  return member.name || member.email || '未知用户';
}

function initials(member: MemberView) {
  return displayName(member)
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function canTouchMember(
  member: MemberView,
  canManage: boolean,
  canManageAdmins: boolean
) {
  if (!canManage || member.role === 'owner') {
    return false;
  }
  return canManageAdmins || member.role !== 'admin';
}

function MemberRoleForm({
  orgId,
  member,
  canManageAdmins,
}: {
  orgId: string;
  member: MemberView;
  canManageAdmins: boolean;
}) {
  const [state, action, isPending] = useActionState<ActionState, FormData>(
    updateOrgMemberRole,
    {}
  );
  const options = canManageAdmins
    ? ['admin', 'editor', 'viewer']
    : ['editor', 'viewer'];

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="memberId" value={member.id} />
      <div className="flex items-center gap-1">
        <select
          name="role"
          defaultValue={member.role}
          aria-label="成员角色"
          className="h-7 rounded-md border border-input bg-background px-1.5 text-xs text-foreground"
        >
          {options.map((role) => (
            <option key={role} value={role}>
              {roleLabel(role)}
            </option>
          ))}
        </select>
        <Button
          type="submit"
          variant="ghost"
          size="icon-xs"
          disabled={isPending}
          title="保存角色"
          aria-label="保存角色"
        >
          <Check />
        </Button>
      </div>
      {state.error ? (
        <p className="text-xs text-destructive">{state.error}</p>
      ) : null}
    </form>
  );
}

function RemoveMemberButton({
  orgId,
  memberId,
}: {
  orgId: string;
  memberId: string;
}) {
  const [state, action, isPending] = useActionState<ActionState, FormData>(
    removeOrgMember,
    {}
  );

  return (
    <form action={action} className="flex flex-col items-end">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="memberId" value={memberId} />
      <Button
        type="submit"
        variant="ghost"
        size="icon-xs"
        disabled={isPending}
        title="移除成员"
        aria-label="移除成员"
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 />
      </Button>
      {state.error ? (
        <p className="text-xs text-destructive">{state.error}</p>
      ) : null}
    </form>
  );
}

export function MembersPanel({
  orgId,
  members,
  canInvite,
  canManage,
  canManageAdmins,
}: {
  orgId: string;
  members: MemberView[];
  canInvite: boolean;
  canManage: boolean;
  canManageAdmins: boolean;
}) {
  const [inviteState, inviteAction, isInviting] = useActionState<
    ActionState,
    FormData
  >(inviteOrgMember, {});
  const inviteRoles = canManageAdmins
    ? ['admin', 'editor', 'viewer']
    : ['editor', 'viewer'];

  return (
    <section className="space-y-4">
      <Card size="dense">
        <CardHeader>
          <CardTitle>团队</CardTitle>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <EmptyState
              className="py-8"
              icon={PlusCircle}
              title="暂无成员"
              description="通过邮箱邀请成员，让他们加入这个组织并参与云谱空间。"
            />
          ) : (
            <Table size="dense">
              <TableHeader>
                <TableRow>
                  <TableHead>成员</TableHead>
                  <TableHead>邮箱</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>加入时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar size="sm">
                          <AvatarFallback>{initials(member)}</AvatarFallback>
                        </Avatar>
                        <span className="max-w-[16rem] truncate font-medium">
                          {displayName(member)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {member.email}
                    </TableCell>
                    <TableCell>
                      <Badge variant={roleVariant(member.role)}>
                        {roleLabel(member.role)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {member.joinedAt}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-start justify-end gap-2">
                        {canTouchMember(member, canManage, canManageAdmins) ? (
                          <>
                            <MemberRoleForm
                              orgId={orgId}
                              member={member}
                              canManageAdmins={canManageAdmins}
                            />
                            <RemoveMemberButton
                              orgId={orgId}
                              memberId={member.id}
                            />
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card size="dense" className="max-w-xl">
        <CardHeader>
          <CardTitle>邀请成员</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={inviteAction} noValidate className="space-y-3">
            <input type="hidden" name="orgId" value={orgId} />
            <div>
              <Label htmlFor="invite-email">邮箱</Label>
              <Input
                id="invite-email"
                name="email"
                type="email"
                placeholder="teammate@example.com"
                disabled={!canInvite}
                size="sm"
                className="mt-1"
              />
            </div>
            <div>
              <Label>角色</Label>
              <RadioGroup
                defaultValue="viewer"
                name="role"
                className="mt-2 flex gap-4"
                disabled={!canInvite}
              >
                {inviteRoles.map((role) => (
                  <div key={role} className="flex items-center gap-2">
                    <RadioGroupItem value={role} id={`role-${role}`} />
                    <Label htmlFor={`role-${role}`} className="font-normal">
                      {roleLabel(role)}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
            {inviteState.error ? (
              <p className="text-xs text-destructive">{inviteState.error}</p>
            ) : null}
            {inviteState.inviteUrl ? (
              <div>
                <Label htmlFor="invite-url">邀请链接</Label>
                <Input
                  id="invite-url"
                  readOnly
                  value={inviteState.inviteUrl}
                  onFocus={(event) => event.currentTarget.select()}
                  size="sm"
                  className="mt-1 font-mono"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  链接 7 天内有效且只能使用一次，请通过安全渠道发送给对方。
                </p>
              </div>
            ) : null}
            {inviteState.success ? (
              <p className="text-xs text-primary">{inviteState.success}</p>
            ) : null}
            <Button
              type="submit"
              variant="brand"
              size="xs"
              disabled={isInviting || !canInvite}
            >
              {isInviting ? (
                <>
                  <Loader2 className="animate-spin" />
                  生成中…
                </>
              ) : (
                <>
                  <PlusCircle />
                  生成邀请链接
                </>
              )}
            </Button>
          </form>
        </CardContent>
        {!canInvite ? (
          <CardFooter>
            <p className="text-xs text-muted-foreground">
              只有所有者或管理员可以邀请新成员。
            </p>
          </CardFooter>
        ) : null}
      </Card>
    </section>
  );
}
