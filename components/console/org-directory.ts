export type OrgDirectoryItem = {
  href: string;
  label: string;
  exact?: boolean;
  count?: number;
};

/** 组织页侧栏的三项目录。计数缺省时不显示数字。 */
export function orgDirectoryItems(org: {
  slug: string;
  projectCount?: number;
  memberCount?: number;
}): OrgDirectoryItem[] {
  return [
    {
      href: `/dashboard/org/${org.slug}`,
      label: '云谱空间',
      exact: true,
      count: org.projectCount,
    },
    {
      href: `/dashboard/org/${org.slug}/team`,
      label: '团队',
      count: org.memberCount,
    },
    {
      href: `/dashboard/org/${org.slug}/settings`,
      label: '组织设置',
    },
  ];
}
