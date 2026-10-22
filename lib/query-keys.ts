export const queryKeys = {
  user: ['user'] as const,
  orgs: ['orgs'] as const,
  projects: (orgId: string) => ['projects', orgId] as const,
};
