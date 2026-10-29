import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTE_EVENT_TYPE_VALUES,
  CALENDAR_VALUES,
  DATE_PRECISION_VALUES,
  DATE_QUALIFIER_VALUES,
  EVENT_KIND_VALUES,
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
  EVENT_KIND_VALUES,
  EVENT_TYPE_VALUES,
  ATTRIBUTE_EVENT_TYPE_VALUES,
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
    expect([...PERSON_NAME_TYPE_VALUES]).toEqual([
      'birth',
      'courtesy',
      'art',
      'posthumous',
      'temple',
      'childhood',
      'maiden',
      'married',
      'aka',
      'religious',
      'professional',
      'school',
      'official',
      'other',
    ]);
    expect([...PARTNER_ROLE_VALUES]).toEqual(['blood', 'spouse']);
    expect([...PARTNER_STATUS_VALUES]).toEqual([
      'current',
      'divorced',
      'widowed',
      'separated',
      'unknown',
    ]);
    expect([...PARENTAGE_TYPE_VALUES]).toEqual([
      'birth',
      'adoptive',
      'foster',
      'step',
      'traditional',
      'unknown',
    ]);
    expect([...UNION_TYPE_VALUES]).toEqual([
      'marriage',
      'cohabitation',
      'unknown',
    ]);
    expect([...EVENT_KIND_VALUES]).toEqual(['event', 'attribute']);
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
    expect([...CALENDAR_VALUES]).toEqual([
      'gregorian',
      'julian',
      'hebrew',
      'french_r',
      'chinese_lunar',
      'other',
    ]);
  });

  it('covers every GEDCOM 7 tag the brief names', () => {
    for (const required of [
      // Standard tags brief Step 3 names explicitly.
      'census',
      'probate',
      'will',
      'naturalization',
      'ordination',
      'confirmation',
      'first_communion',
      'blessing',
      'barmitzvah',
      'basmitzvah',
      'graduation',
      'retirement',
      'emigration',
      'immigration',
      'residence',
      'migration',
      'occupation',
      'education',
      'title',
      'nationality',
      'property',
      'religion',
      'cremation',
      'adoption',
      'christening',
      'baptism',
      'engagement',
      'divorce',
      'annulment',
      'military_service',
      // Standard tags the review found were previously forced into `custom`.
      'adult_christening',
      'divorce_filed',
      'marriage_bann',
      'marriage_contract',
      'marriage_license',
      'marriage_settlement',
      // Core events the original test already pinned.
      'birth',
      'death',
      'burial',
      'marriage',
      // Chinese genealogy events.
      'succession',
      'ancestral_hall',
      'genealogy_compiled',
      'name_change',
      'posthumous_title',
      // Fallbacks.
      'custom',
      'other',
    ]) {
      expect(EVENT_TYPE_VALUES, required).toContain(required);
    }
  });

  it('pins the GEDCOM 7 attribute event types inside the event types', () => {
    expect([...ATTRIBUTE_EVENT_TYPE_VALUES]).toEqual([
      'occupation',
      'education',
      'residence',
      'title',
      'nationality',
      'property',
      'religion',
      'caste',
      'physical_description',
      'national_id_number',
      'number_of_children',
      'number_of_marriages',
      'social_security_number',
      'fact',
    ]);
    const eventTypes = new Set<string>(EVENT_TYPE_VALUES);
    for (const attribute of ATTRIBUTE_EVENT_TYPE_VALUES) {
      expect(eventTypes.has(attribute), attribute).toBe(true);
    }
    expect(ATTRIBUTE_EVENT_TYPE_VALUES).not.toContain('custom');
    expect(ATTRIBUTE_EVENT_TYPE_VALUES).not.toContain('other');
  });
});
