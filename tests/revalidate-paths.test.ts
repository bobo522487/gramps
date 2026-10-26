import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { revalidatePath } = await import('next/cache');
const { revalidateOrg, revalidateProject, revalidateWholeConsole } =
  await import('@/lib/lineage/revalidate');

const ORG_SLUG = 'orgslug123456789abc';
const PROJECT_REF = 'projref123456789abc';

describe('revalidate scoping', () => {
  it('scopes a lineage write to its own project subtree', () => {
    vi.mocked(revalidatePath).mockClear();
    revalidateProject(ORG_SLUG, PROJECT_REF);

    expect(revalidatePath).toHaveBeenCalledTimes(2);
    expect(revalidatePath).toHaveBeenCalledWith(
      `/dashboard/project/${PROJECT_REF}`,
      'layout'
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      `/dashboard/org/${ORG_SLUG}`,
      'layout'
    );
  });

  it('never blows up the whole console for a project-scoped write', () => {
    vi.mocked(revalidatePath).mockClear();
    revalidateProject(ORG_SLUG, PROJECT_REF);

    expect(revalidatePath).not.toHaveBeenCalledWith('/dashboard', 'layout');
  });

  it('scopes an org-only write to that organization', () => {
    vi.mocked(revalidatePath).mockClear();
    revalidateOrg(ORG_SLUG);

    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith(
      `/dashboard/org/${ORG_SLUG}`,
      'layout'
    );
  });

  it('keeps the whole-console invalidation for membership changes', () => {
    vi.mocked(revalidatePath).mockClear();
    revalidateWholeConsole();

    expect(revalidatePath).toHaveBeenCalledWith('/dashboard', 'layout');
  });
});
