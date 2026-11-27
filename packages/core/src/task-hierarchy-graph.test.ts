import { describe, expect, it } from 'vitest';
import {
    HIERARCHY_H_GAP,
    HIERARCHY_NODE_HEIGHT,
    HIERARCHY_NODE_WIDTH,
    HIERARCHY_V_GAP,
    buildTaskHierarchyGraph,
    collectHierarchyIds,
    findDefaultHierarchyRoot,
    findHierarchyTopRoot,
    getHierarchyAncestorPath,
    layoutTaskHierarchyGraph,
} from './task-hierarchy-graph';
import type { Task } from './types';

const createTask = (overrides: Partial<Task> = {}): Task => ({
    id: 't1',
    title: 'Task',
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    rev: 1,
    ...overrides,
});

const chain = (): Task[] => [
    createTask({ id: 'root', title: 'Root', links: { parents: [], children: ['a', 'b'] } }),
    createTask({ id: 'a', title: 'A', links: { parents: ['root'], children: ['a1'] } }),
    createTask({ id: 'a1', title: 'A1', links: { parents: ['a'], children: [] } }),
    createTask({ id: 'b', title: 'B', links: { parents: ['root'], children: [] } }),
    createTask({ id: 'solo', title: 'Solo' }),
];

describe('task hierarchy graph', () => {
    it('exposes both sides of every link and skips deleted tasks', () => {
        const tasks = [...chain(), createTask({ id: 'gone', deletedAt: '2026-01-02T00:00:00.000Z' })];
        const graph = buildTaskHierarchyGraph(tasks);

        expect(graph.nodes.get('root')?.childIds).toEqual(['a', 'b']);
        expect(graph.nodes.get('a')?.parentIds).toEqual(['root']);
        expect(graph.nodes.has('gone')).toBe(false);
        expect(graph.roots).toEqual(['root', 'solo']);
        expect(graph.order).toEqual(['root', 'a', 'a1', 'b', 'solo']);
    });

    it('collects a subtree and its ancestor path', () => {
        const graph = buildTaskHierarchyGraph(chain());

        expect(collectHierarchyIds(graph, 'root')).toEqual(['root', 'a', 'b', 'a1']);
        expect(collectHierarchyIds(graph, 'a')).toEqual(['a', 'a1']);
        expect(collectHierarchyIds(graph, 'missing')).toEqual([]);
        expect(getHierarchyAncestorPath(graph, 'a1')).toEqual(['root', 'a']);
        expect(getHierarchyAncestorPath(graph, 'root')).toEqual([]);
        expect(findHierarchyTopRoot(graph, 'a1')).toBe('root');
    });

    it('prefers the first root that actually has children', () => {
        const graph = buildTaskHierarchyGraph([
            createTask({ id: 'empty' }),
            ...chain(),
        ]);

        expect(findDefaultHierarchyRoot(graph)).toBe('root');
        expect(findDefaultHierarchyRoot(buildTaskHierarchyGraph([createTask({ id: 'only' })]))).toBe('only');
        expect(findDefaultHierarchyRoot(buildTaskHierarchyGraph([]))).toBeNull();
    });
});

describe('task hierarchy layout', () => {
    it('places one depth per row and centers parents over their children', () => {
        const layout = layoutTaskHierarchyGraph(buildTaskHierarchyGraph(chain()), 'root');
        const byId = layout.byId;

        expect(layout.nodes).toHaveLength(4);
        expect(byId.get('root')?.depth).toBe(0);
        expect(byId.get('a')?.depth).toBe(1);
        expect(byId.get('b')?.depth).toBe(1);
        expect(byId.get('a1')?.depth).toBe(2);

        expect(byId.get('a')?.x).toBe(0);
        expect(byId.get('b')?.x).toBe(HIERARCHY_NODE_WIDTH + HIERARCHY_H_GAP);
        expect(byId.get('root')?.x).toBe(((byId.get('a')?.x ?? 0) + (byId.get('b')?.x ?? 0)) / 2);
        expect(byId.get('a1')?.x).toBe(0);

        expect(byId.get('a')?.y).toBe(HIERARCHY_NODE_HEIGHT + HIERARCHY_V_GAP);
        expect(byId.get('a1')?.y).toBe(2 * (HIERARCHY_NODE_HEIGHT + HIERARCHY_V_GAP));
        expect(layout.maxDepth).toBe(2);
        expect(layout.width).toBe(2 * (HIERARCHY_NODE_WIDTH + HIERARCHY_H_GAP) + HIERARCHY_H_GAP);
        expect(layout.height).toBe(3 * (HIERARCHY_NODE_HEIGHT + HIERARCHY_V_GAP) + HIERARCHY_V_GAP);
    });

    it('draws one edge per link and flags secondary parents as cross links', () => {
        const tasks = [
            createTask({ id: 'p1', links: { parents: [], children: ['shared'] } }),
            createTask({ id: 'p2', links: { parents: [], children: ['shared'] } }),
            createTask({ id: 'shared', links: { parents: ['p1', 'p2'], children: [] } }),
        ];
        const layout = layoutTaskHierarchyGraph(buildTaskHierarchyGraph(tasks), 'p1');

        expect(layout.nodes.map((node) => node.id)).toEqual(['p1', 'shared']);
        expect(layout.edges).toHaveLength(1);
        expect(layout.edges[0]).toMatchObject({ parentId: 'p1', childId: 'shared', crossLink: false });

        const both = layoutTaskHierarchyGraph(buildTaskHierarchyGraph(tasks), 'p2');
        expect(both.edges.map((edge) => edge.crossLink)).toEqual([false]);
    });

    it('honors custom sizing and terminates on a cyclic graph', () => {
        const layout = layoutTaskHierarchyGraph(buildTaskHierarchyGraph(chain()), 'root', {
            nodeWidth: 100,
            nodeHeight: 40,
            horizontalGap: 10,
            verticalGap: 20,
        });
        expect(layout.byId.get('root')?.width).toBe(100);
        expect(layout.byId.get('b')?.x).toBe(110);
        expect(layout.byId.get('a')?.y).toBe(60);

        const cyclic = [
            createTask({ id: 'x', links: { parents: ['y'], children: ['y'] } }),
            createTask({ id: 'y', links: { parents: ['x'], children: ['x'] } }),
        ];
        const cyclicLayout = layoutTaskHierarchyGraph(buildTaskHierarchyGraph(cyclic), 'x');
        expect(cyclicLayout.nodes.map((node) => node.id)).toEqual(['x', 'y']);
        expect(cyclicLayout.maxDepth).toBe(1);
    });
});
