import { describe, expect, it } from 'vitest';
import {
  CALENDAR_VALUES,
  DATE_PRECISION_VALUES,
  DATE_QUALIFIER_VALUES,
  EVENT_TYPE_VALUES,
  LIVING_STATUS_VALUES,
  NAME_STATUS_VALUES,
  PARENTAGE_TYPE_VALUES,
  PARTNER_ROLE_VALUES,
  PARTNER_STATUS_VALUES,
  PERSON_NAME_TYPE_VALUES,
  PERSON_SEX_VALUES,
  PRIVACY_LEVEL_VALUES,
  UNION_TYPE_VALUES,
} from '@/lib/genealogy/constants';

const ALL = {
  PERSON_SEX_VALUES,
  LIVING_STATUS_VALUES,
  PRIVACY_LEVEL_VALUES,
  NAME_STATUS_VALUES,
  PERSON_NAME_TYPE_VALUES,
  PARTNER_ROLE_VALUES,
  PARTNER_STATUS_VALUES,
  PARENTAGE_TYPE_VALUES,
  UNION_TYPE_VALUES,
  EVENT_TYPE_VALUES,
  DATE_PRECISION_VALUES,
  DATE_QUALIFIER_VALUES,
  CALENDAR_VALUES,
};

describe('genealogy constants', () => {
  it('has no duplicate values in any enum', () => {
    for (const [name, values] of Object.entries(ALL)) {
      expect(new Set(values).size, name).toBe(values.length);
    }
  });

  it('pins the values the blueprint names explicitly', () => {
    expect([...PERSON_SEX_VALUES]).toEqual([
      'male',
      'female',
      'other',
      'unknown',
    ]);
    expect([...LIVING_STATUS_VALUES]).toEqual([
      'living',
      'deceased',
      'unknown',
    ]);
    expect([...PRIVACY_LEVEL_VALUES]).toEqual([
      'public',
      'restricted',
      'private',
    ]);
    expect([...NAME_STATUS_VALUES]).toEqual(['known', 'unknown', 'partial']);
    expect([...PARTNER_ROLE_VALUES]).toEqual(['blood', 'spouse']);
    expect([...PARENTAGE_TYPE_VALUES]).toEqual([
      'birth',
      'adoptive',
      'foster',
      'step',
      'traditional',
      'unknown',
    ]);
    expect([...DATE_QUALIFIER_VALUES]).toEqual([
      'exact',
      'about',
      'estimated',
      'calculated',
      'before',
      'after',
      'between',
      'period',
      'unknown',
    ]);
    expect([...DATE_PRECISION_VALUES]).toEqual([
      'day',
      'month',
      'year',
      'decade',
      'century',
    ]);
  });

  it('covers the event types P1 backfill and Chinese genealogy need', () => {
    for (const required of [
      'birth',
      'death',
      'burial',
      'marriage',
      'succession',
      'ancestral_hall',
      'genealogy_compiled',
      'name_change',
      'posthumous_title',
    ]) {
      expect(EVENT_TYPE_VALUES, required).toContain(required);
    }
  });
});
