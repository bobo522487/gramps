import type { PersonSex } from '@/lib/genealogy/constants';

export function sexLabel(sex: PersonSex): string {
  switch (sex) {
    case 'male':
      return '男';
    case 'female':
      return '女';
    case 'other':
      return '其他';
    case 'unknown':
      return '不详';
  }
}

export function rankSuffix(sex: PersonSex): '子' | '女' | '人' {
  if (sex === 'male') {
    return '子';
  }
  if (sex === 'female') {
    return '女';
  }
  return '人';
}
