import { describe, expect, it } from 'vitest';
import {
    buildTaskLinkIndex,
    buildTaskLinkUpdates,
    canLinkTasks,
    collectLinkedIds,
    getLinkedChildIds,
    getLinkedParentIds,
    getTaskLinks,
    normalizeTaskLinks,
    normalizeTaskLinksForComparison,
    taskLinksEqual,
    unionTaskLinks,
} from './task-links';
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

describe('task link normalization', () => {
    it('drops malformed entries, self references and duplicates', () => {
        expect(normalizeTaskLinks({
            parents: [' a ', 'a', '', 42, null, 't1'],
            children: [' b ', 'b'],
        }, 't1')).toEqual({ parents: ['a'], children: ['b'] });
    });

    it('treats missing or empty link payloads as undefined', () => {
        expect(normalizeTaskLinks(undefined)).toBeUndefined();
        expect(normalizeTaskLinks(null)).toBeUndefined();
        expect(normalizeTaskLinks([{ parents: ['a'] }])).toBeUndefined();
        expect(normalizeTaskLinks({ parents: [], children: [] })).toBeUndefined();
        expect(normalizeTaskLinks({ parents: [' '], children: [''] })).toBeUndefined();
    });

    it('projects a stored task onto a stable link view', () => {
        expect(getTaskLinks(createTask({ links: { parents: ['p1'], children: [] } }))).toEqual({
            parents: ['p1'],
            children: [],
        });
        expect(getTaskLinks(createTask())).toEqual({ parents: [], children: [] });
    });

    it('unions both sides without duplicating ids', () => {
        expect(unionTaskLinks(
            { parents: ['p1'], children: ['c1'] },
            { parents: ['p1', 'p2'], children: ['c2'] },
        )).toEqual({ parents: ['p1', 'p2'], children: ['c1', 'c2'] });
        expect(unionTaskLinks(undefined, undefined)).toEqual({ parents: [], children: [] });
    });

    it('compares links regardless of declaration order', () => {
        expect(taskLinksEqual(
            { parents: ['p1', 'p2'], children: ['c1'] },
            { parents: ['p2', 'p1'], children: ['c1'] },
        )).toBe(true);
        expect(taskLinksEqual({ parents: ['p1'], children: [] }, undefined)).toBe(false);
        expect(normalizeTaskLinksForComparison({ parents: ['p2', 'p1'], children: ['c1'] }))
            .toEqual(['p:p1', 'p:p2', 'c:c1']);
        expect(normalizeTaskLinksForComparison(undefined)).toBeUndefined();
    });
});

describe('task link index', () => {
    it('derives edges when only one side declares the relationship', () => {
        const parent = createTask({ id: 'parent', links: { parents: [], children: ['child'] } });
        const child = createTask({ id: 'child' });
        const index = buildTaskLinkIndex([parent, child]);

        expect(index.edges).toEqual([{ parentId: 'parent', childId: 'child' }]);
        expect(getLinkedChildIds(index, 'parent')).toEqual(['child']);
        expect(getLinkedParentIds(index, 'child')).toEqual(['parent']);
    });

    it('ignores deleted tasks, missing endpoints and self edges', () => {
        const parent = createTask({ id: 'parent', links: { parents: [], children: ['child', 'ghost', 'parent'] } });
        const child = createTask({ id: 'child', deletedAt: '2026-01-02T00:00:00.000Z' });
        const index = buildTaskLinkIndex([parent, child]);

        expect(index.edges).toEqual([]);
        expect(getLinkedChildIds(index, 'parent')).toEqual([]);
    });

    it('walks ancestors and descendants without revisiting nodes', () => {
        const tasks = [
            createTask({ id: 'root', links: { parents: [], children: ['mid'] } }),
            createTask({ id: 'mid', links: { parents: ['root'], children: ['leaf'] } }),
            createTask({ id: 'leaf', links: { parents: ['mid'], children: [] } }),
        ];
        const index = buildTaskLinkIndex(tasks);

        expect(collectLinkedIds(index, 'leaf', 'parent')).toEqual(['mid', 'root']);
        expect(collectLinkedIds(index, 'root', 'child')).toEqual(['mid', 'leaf']);
        expect(collectLinkedIds(index, 'mid', 'child')).toEqual(['leaf']);
        expect(canLinkTasks(index, 'root', 'leaf')).toBe('ok');
        expect(canLinkTasks(index, 'leaf', 'root')).toBe('cycle');
        expect(canLinkTasks(index, 'root', 'root')).toBe('self');
    });
});

describe('task link update planning', () => {
    const tasks = [
        createTask({ id: 'a' }),
        createTask({ id: 'b' }),
        createTask({ id: 'c' }),
    ];

    it('writes the relationship on both tasks', () => {
        const plan = buildTaskLinkUpdates(tasks, { parentId: 'a', childId: 'b', operation: 'link' });

        expect(plan.ok).toBe(true);
        if (!plan.ok) return;
        expect(plan.changed).toBe(true);
        expect(plan.updates).toEqual([
            { id: 'a', updates: { links: { parents: [], children: ['b'] } } },
            { id: 'b', updates: { links: { parents: ['a'], children: [] } } },
        ]);
    });

    it('keeps existing links when adding a second parent', () => {
        const existing = [
            createTask({ id: 'a', links: { parents: [], children: ['c'] } }),
            createTask({ id: 'b' }),
            createTask({ id: 'c', links: { parents: ['a'], children: [] } }),
        ];
        const plan = buildTaskLinkUpdates(existing, { parentId: 'b', childId: 'c', operation: 'link' });

        expect(plan.ok).toBe(true);
        if (!plan.ok) return;
        expect(plan.updates).toEqual([
            { id: 'b', updates: { links: { parents: [], children: ['c'] } } },
            { id: 'c', updates: { links: { parents: ['a', 'b'], children: [] } } },
        ]);
    });

    it('is idempotent for repeated links and unlinks', () => {
        const linked = [
            createTask({ id: 'a', links: { parents: [], children: ['b'] } }),
            createTask({ id: 'b', links: { parents: ['a'], children: [] } }),
        ];
        expect(buildTaskLinkUpdates(linked, { parentId: 'a', childId: 'b', operation: 'link' }))
            .toEqual({ ok: true, updates: [], changed: false });

        const unlinked = buildTaskLinkUpdates(linked, { parentId: 'a', childId: 'b', operation: 'unlink' });
        expect(unlinked.ok).toBe(true);
        if (!unlinked.ok) return;
        expect(unlinked.updates).toEqual([
            { id: 'a', updates: { links: undefined } },
            { id: 'b', updates: { links: undefined } },
        ]);

        expect(buildTaskLinkUpdates(tasks, { parentId: 'a', childId: 'c', operation: 'unlink' }))
            .toEqual({ ok: true, updates: [], changed: false });
    });

    it('rejects self links, cycles and unavailable tasks', () => {
        const chained = [
            createTask({ id: 'a', links: { parents: [], children: ['b'] } }),
            createTask({ id: 'b', links: { parents: ['a'], children: ['c'] } }),
            createTask({ id: 'c', links: { parents: ['b'], children: [] } }),
        ];

        expect(buildTaskLinkUpdates(chained, { parentId: 'a', childId: 'a', operation: 'link' }))
            .toEqual({ ok: false, reason: 'self' });
        expect(buildTaskLinkUpdates(chained, { parentId: 'c', childId: 'a', operation: 'link' }))
            .toEqual({ ok: false, reason: 'cycle' });
        expect(buildTaskLinkUpdates(chained, { parentId: 'a', childId: 'missing', operation: 'link' }))
            .toEqual({ ok: false, reason: 'missing' });
        expect(buildTaskLinkUpdates([
            createTask({ id: 'a', deletedAt: '2026-01-02T00:00:00.000Z' }),
            createTask({ id: 'b' }),
        ], { parentId: 'a', childId: 'b', operation: 'link' }))
            .toEqual({ ok: false, reason: 'deleted' });
    });
});
