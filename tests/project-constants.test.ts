import { describe, expect, it } from 'vitest';
import {
  PROJECT_STATUS_OPTIONS,
  projectStatusLabel,
} from '@/lib/project/constants';

describe('project status constants', () => {
  it('maps statuses to Chinese labels in display order', () => {
    expect(
      PROJECT_STATUS_OPTIONS.map(({ value, label }) => [value, label])
    ).toEqual([
      ['planning', '筹备中'],
      ['in_progress', '进行中'],
      ['completed', '已完成'],
    ]);
  });

  it('falls back to the raw value for unknown statuses', () => {
    expect(projectStatusLabel('in_progress')).toBe('进行中');
    expect(projectStatusLabel('archived')).toBe('archived');
  });
});
