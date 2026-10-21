import {
  Activity,
  AlertCircle,
  Archive,
  BookOpen,
  Building2,
  CheckCircle,
  FileText,
  FolderKanban,
  Lock,
  LogOut,
  type LucideIcon,
  Mail,
  Move,
  Network,
  Pencil,
  Settings,
  Trash2,
  UserCog,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import { EmptyState } from '@/components/console/empty-state';
import { PageHeader } from '@/components/console/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/context';
import { getActivityLogs } from '@/lib/db/queries/activity';
import { ActivityType } from '@/lib/db/schema';

const iconMap: Record<ActivityType, LucideIcon> = {
  [ActivityType.SIGN_UP]: UserPlus,
  [ActivityType.SIGN_IN]: UserCog,
  [ActivityType.SIGN_OUT]: LogOut,
  [ActivityType.UPDATE_PASSWORD]: Lock,
  [ActivityType.DELETE_ACCOUNT]: UserMinus,
  [ActivityType.UPDATE_ACCOUNT]: Settings,
  [ActivityType.CREATE_ORG]: Building2,
  [ActivityType.RENAME_ORG]: Pencil,
  [ActivityType.ARCHIVE_ORG]: Archive,
  [ActivityType.REMOVE_ORG_MEMBER]: UserMinus,
  [ActivityType.UPDATE_MEMBER_ROLE]: UserCog,
  [ActivityType.INVITE_ORG_MEMBER]: Mail,
  [ActivityType.ACCEPT_INVITATION]: CheckCircle,
  [ActivityType.CREATE_PROJECT]: FolderKanban,
  [ActivityType.UPDATE_PROJECT]: Pencil,
  [ActivityType.DELETE_PROJECT]: Trash2,
  [ActivityType.CREATE_FOLDER]: FolderKanban,
  [ActivityType.RENAME_FOLDER]: Pencil,
  [ActivityType.DELETE_FOLDER]: Trash2,
  [ActivityType.CREATE_LINEAGE]: Network,
  [ActivityType.UPDATE_LINEAGE]: Pencil,
  [ActivityType.DELETE_LINEAGE]: Trash2,
  [ActivityType.CREATE_NODE]: UserPlus,
  [ActivityType.UPDATE_NODE]: UserCog,
  [ActivityType.DELETE_NODE]: UserMinus,
  [ActivityType.MOVE_NODE]: Move,
  [ActivityType.CREATE_ARTICLE]: FileText,
  [ActivityType.UPDATE_ARTICLE]: Pencil,
  [ActivityType.DELETE_ARTICLE]: Trash2,
  [ActivityType.CREATE_BOOK]: BookOpen,
  [ActivityType.UPDATE_BOOK]: Pencil,
  [ActivityType.DELETE_BOOK]: Trash2,
};

function getRelativeTime(date: Date) {
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return '刚刚';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} 分钟前`;
  if (diffInSeconds < 86400)
    return `${Math.floor(diffInSeconds / 3600)} 小时前`;
  if (diffInSeconds < 604800)
    return `${Math.floor(diffInSeconds / 86400)} 天前`;
  return date.toLocaleDateString('zh-CN');
}

function formatAction(action: ActivityType): string {
  switch (action) {
    case ActivityType.SIGN_UP:
      return '你注册了账号';
    case ActivityType.SIGN_IN:
      return '你登录了账号';
    case ActivityType.SIGN_OUT:
      return '你退出了登录';
    case ActivityType.UPDATE_PASSWORD:
      return '你修改了密码';
    case ActivityType.DELETE_ACCOUNT:
      return '你删除了账号';
    case ActivityType.UPDATE_ACCOUNT:
      return '你更新了账号信息';
    case ActivityType.CREATE_ORG:
      return '你创建了组织';
    case ActivityType.RENAME_ORG:
      return '你重命名了组织';
    case ActivityType.ARCHIVE_ORG:
      return '你归档了组织';
    case ActivityType.REMOVE_ORG_MEMBER:
      return '你移除了组织成员';
    case ActivityType.UPDATE_MEMBER_ROLE:
      return '你调整了成员角色';
    case ActivityType.INVITE_ORG_MEMBER:
      return '你邀请了组织成员';
    case ActivityType.ACCEPT_INVITATION:
      return '你接受了一个邀请';
    case ActivityType.CREATE_PROJECT:
      return '你创建了云谱空间';
    case ActivityType.UPDATE_PROJECT:
      return '你更新了云谱空间';
    case ActivityType.DELETE_PROJECT:
      return '你删除了云谱空间';
    case ActivityType.CREATE_FOLDER:
      return '你创建了分类';
    case ActivityType.RENAME_FOLDER:
      return '你重命名了分类';
    case ActivityType.DELETE_FOLDER:
      return '你删除了分类';
    case ActivityType.CREATE_LINEAGE:
      return '你创建了谱系';
    case ActivityType.UPDATE_LINEAGE:
      return '你更新了谱系';
    case ActivityType.DELETE_LINEAGE:
      return '你删除了谱系';
    case ActivityType.CREATE_NODE:
      return '你录入了人丁';
    case ActivityType.UPDATE_NODE:
      return '你更新了人丁信息';
    case ActivityType.DELETE_NODE:
      return '你删除了人丁';
    case ActivityType.MOVE_NODE:
      return '你移动了人丁';
    case ActivityType.CREATE_ARTICLE:
      return '你创建了谱文';
    case ActivityType.UPDATE_ARTICLE:
      return '你更新了谱文';
    case ActivityType.DELETE_ARTICLE:
      return '你删除了谱文';
    case ActivityType.CREATE_BOOK:
      return '你创建了谱书';
    case ActivityType.UPDATE_BOOK:
      return '你更新了谱书';
    case ActivityType.DELETE_BOOK:
      return '你删除了谱书';
    default:
      return '发生未知操作';
  }
}

export default async function ActivityPage() {
  const user = await requireUser();
  const logs = await getActivityLogs(user.id);

  return (
    <section className="space-y-4 p-4 lg:p-6">
      <PageHeader
        icon={Activity}
        title="活动日志"
        description="你的登录记录与账号变更。"
      />
      <Card size="dense" className="max-w-2xl">
        <CardHeader>
          <CardTitle>最近活动</CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length > 0 ? (
            <ul className="space-y-3">
              {logs.map((log) => {
                const Icon = iconMap[log.action as ActivityType] || Settings;
                const formattedAction = formatAction(
                  log.action as ActivityType
                );

                return (
                  <li key={log.id} className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Icon className="size-4" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">
                        {formattedAction}
                        {log.ipAddress && ` 来自 IP ${log.ipAddress}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {getRelativeTime(new Date(log.timestamp))}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              icon={AlertCircle}
              title="暂无活动"
              description="当你登录或更新账号信息后，相关记录会显示在这里。"
            />
          )}
        </CardContent>
      </Card>
    </section>
  );
}
