import { describe, expect, it } from 'vitest';
import { createProject as createProjectQuery } from '@/lib/db/queries';
import { createOrganization, createProject } from '../helpers/factories';

describe('createProject unique-id retries', () => {
  it('uses the slugified name when it is free', async () => {
    const organization = await createOrganization();

    const created = await createProjectQuery({
      orgId: organization.id,
      name: 'Unique Name',
      region: 'us-east-1',
    });

    expect(created?.slug).toBe('unique-name');
  });

  it('regenerates the slug when the first attempt collides', async () => {
    const organization = await createOrganization();
    await createProject({ orgId: organization.id, slug: 'same-name' });

    const created = await createProjectQuery({
      orgId: organization.id,
      name: 'Same Name',
      region: 'us-east-1',
    });

    expect(created?.slug).not.toBe('same-name');
    expect(created?.slug.startsWith('same-name-')).toBe(true);
  });
});
