import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { buildLineageIndex } from '@/components/lineage/derived';
import {
  LineageIndexProvider,
  useLineageIndex,
} from '@/components/lineage/lineage-index-context';
import type { NodeView } from '@/components/lineage/types';

const nodes: NodeView[] = [
  {
    id: 'n1',
    parentId: null,
    spouseOfId: null,
    role: 'blood',
    generation: 1,
    sort: 0,
    name: '实',
    surname: '陈',
    fullName: '陈实',
    sex: 0,
    courtesy: null,
    namePrefix: null,
    isAlive: true,
    birthText: null,
    deathText: null,
    birthYear: null,
    deathYear: null,
    burialPlace: null,
    biography: null,
  },
];

/** A consumer that reports only how many nodes its index holds. */
function Consumer({ label }: { label: string }) {
  const index = useLineageIndex();
  return <span>{`${label}:${index.byId.size}`}</span>;
}

describe('LineageIndexProvider', () => {
  it('builds the index once for every consumer in the tree', () => {
    const build = vi.fn(buildLineageIndex);
    const html = renderToStaticMarkup(
      <LineageIndexProvider nodes={nodes} build={build}>
        <Consumer label="canvas" />
        <Consumer label="inspector" />
        <Consumer label="dialog" />
        <Consumer label="table" />
      </LineageIndexProvider>
    );

    expect(build).toHaveBeenCalledTimes(1);
    expect(html).toContain('canvas:1');
    expect(html).toContain('table:1');
  });

  it('throws outside a provider instead of silently rendering an empty tree', () => {
    expect(() => renderToStaticMarkup(<Consumer label="orphan" />)).toThrow(
      /LineageIndexProvider/
    );
  });
});
