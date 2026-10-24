export const PROJECT_STATUS_VALUES = [
  'planning',
  'in_progress',
  'completed',
] as const;

export type ProjectStatus = (typeof PROJECT_STATUS_VALUES)[number];

export const PROJECT_STATUS_OPTIONS: ReadonlyArray<{
  value: ProjectStatus;
  label: string;
}> = [
  { value: 'planning', label: '筹备中' },
  { value: 'in_progress', label: '进行中' },
  { value: 'completed', label: '已完成' },
];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: '筹备中',
  in_progress: '进行中',
  completed: '已完成',
};

export const DEFAULT_PROJECT_STATUS: ProjectStatus = 'in_progress';
export const DEFAULT_PROJECT_IMPORTANCE = 1;
export const MAX_PROJECT_NAME_LENGTH = 24;
export const MAX_PROJECT_SURNAME_LENGTH = 30;
export const MAX_PROJECT_THEME_NAME_LENGTH = 60;
export const MAX_PROJECT_REGIONS_LENGTH = 100;
export const MAX_PROJECT_NOTES_LENGTH = 500;
export const PROJECT_IMPORTANCE_MAX = 5;

export function projectStatusLabel(value: string): string {
  return PROJECT_STATUS_LABELS[value as ProjectStatus] ?? value;
}
