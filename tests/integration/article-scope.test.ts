import { describe, expect, it } from 'vitest';
import { getArticleScopeForMember } from '@/lib/db/queries/articles';
import {
  addMember,
  createArticle,
  createProject,
  createUser,
  getPersonalOrg,
} from '../helpers/factories';

async function setup() {
  const owner = await createUser();
  const personal = await getPersonalOrg(owner.id);
  if (!personal) {
    throw new Error('expected signup trigger to create a personal org');
  }
  const project = await createProject({
    orgId: personal.organization.id,
    createdBy: owner.id,
  });
  const article = await createArticle({
    orgId: personal.organization.id,
    projectId: project.id,
  });
  return { owner, organization: personal.organization, article };
}

describe('getArticleScopeForMember', () => {
  it('resolves the article for members and null for outsiders', async () => {
    const { owner, organization, article } = await setup();
    const viewer = await createUser();
    await addMember({
      userId: viewer.id,
      organizationId: organization.id,
      role: 'viewer',
    });
    const outsider = await createUser();

    expect(
      await getArticleScopeForMember(owner.id, organization.id, article.id)
    ).toMatchObject({ id: article.id });
    expect(
      await getArticleScopeForMember(viewer.id, organization.id, article.id)
    ).toMatchObject({ id: article.id });
    expect(
      await getArticleScopeForMember(outsider.id, organization.id, article.id)
    ).toBeNull();
  });
});
