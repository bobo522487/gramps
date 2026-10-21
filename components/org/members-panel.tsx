'use client';

import { Loader2, PlusCircle, Trash2 } from 'lucide-react';
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
import { inviteOrgMember, removeOrgMember } from '@/lib/org/actions';
import { roleLabel, statusVariant } from '@/lib/ui/status';

export type MemberView = {
  id: number;
  name: string | null;
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

export function MembersPanel({
  orgId,
  members,
  isOwner,
}: {
  orgId: number;
  members: MemberView[];
  isOwner: boolean;
}) {
  const [removeState, removeAction, isRemoving] = useActionState<
    ActionState,
    FormData
  >(removeOrgMember, {});
  const [inviteState, inviteAction, isInviting] = useActionState<
    ActionState,
    FormData
  >(inviteOrgMember, {});

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
              description="通过邮箱邀请成员，让他们加入这个组织并参与项目。"
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
                      <Badge variant={statusVariant(member.role)}>
                        {roleLabel(member.role)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {member.joinedAt}
                    </TableCell>
                    <TableCell className="text-right">
                      {isOwner && member.role !== 'owner' ? (
                        <form
                          action={removeAction}
                          className="inline-flex flex-col items-end"
                        >
                          <input type="hidden" name="orgId" value={orgId} />
                          <input
                            type="hidden"
                            name="memberId"
                            value={member.id}
                          />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="icon-xs"
                            disabled={isRemoving}
                            title="移除成员"
                            aria-label="移除成员"
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 />
                          </Button>
                        </form>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {removeState.error ? (
            <p className="mt-2 text-xs text-destructive">{removeState.error}</p>
          ) : null}
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
                disabled={!isOwner}
                size="sm"
                className="mt-1"
              />
            </div>
            <div>
              <Label>角色</Label>
              <RadioGroup
                defaultValue="member"
                name="role"
                className="mt-2 flex gap-4"
                disabled={!isOwner}
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="member" id="role-member" />
                  <Label htmlFor="role-member" className="font-normal">
                    成员
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="owner" id="role-owner" />
                  <Label htmlFor="role-owner" className="font-normal">
                    所有者
                  </Label>
                </div>
              </RadioGroup>
            </div>
            {inviteState.error ? (
              <p className="text-xs text-destructive">{inviteState.error}</p>
            ) : null}
            {inviteState.success ? (
              <p className="text-xs text-primary">{inviteState.success}</p>
            ) : null}
            <Button
              type="submit"
              variant="brand"
              size="xs"
              disabled={isInviting || !isOwner}
            >
              {isInviting ? (
                <>
                  <Loader2 className="animate-spin" />
                  邀请中…
                </>
              ) : (
                <>
                  <PlusCircle />
                  邀请成员
                </>
              )}
            </Button>
          </form>
        </CardContent>
        {!isOwner ? (
          <CardFooter>
            <p className="text-xs text-muted-foreground">
              只有组织所有者可以邀请新成员。
            </p>
          </CardFooter>
        ) : null}
      </Card>
    </section>
  );
}
