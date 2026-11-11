import { describe, expect, it } from 'vitest';
import { getTestSql, pgErrorCode } from '../helpers/db';
import {
  createProject,
  createUser,
  getPersonalOrg,
} from '../helpers/factories';

async function sqlState(run: () => unknown): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return pgErrorCode(error);
  }
}

describe('person.surname', () => {
  it('allows a null surname and rejects a blank one', async () => {
    const user = await createUser();
    const personal = await getPersonalOrg(user.id);
    if (!personal) {
      throw new Error('missing personal org');
    }
    const project = await createProject({
      orgId: personal.organization.id,
      createdBy: user.id,
    });
    const sql = getTestSql();
    expect(
      await sqlState(
        () => sql`
          insert into person (organization_id, project_id)
          values (${personal.organization.id}, ${project.id})
        `
      )
    ).toBeUndefined();
    expect(
      await sqlState(
        () => sql`
          update person
          set surname = '   '
          where project_id = ${project.id}
        `
      )
    ).toBe('23514');
  });
});
