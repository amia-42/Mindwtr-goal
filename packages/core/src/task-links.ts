import type { Task, TaskLinks } from './types';

export type TaskLinkDirection = 'parent' | 'child';

export type TaskLinkUpdate = { id: string; updates: Partial<Task> };

export type TaskLinkPlan =
    | { ok: true; updates: TaskLinkUpdate[]; changed: boolean }
    | { ok: false; reason: 'missing' | 'deleted' | 'self' | 'cycle' };

export type TaskLinkEdge = { parentId: string; childId: string };

export type TaskLinkIndex = {
    edges: TaskLinkEdge[];
    parentsById: Map<string, string[]>;
    childrenById: Map<string, string[]>;
};

export const EMPTY_TASK_LINKS: TaskLinks = { parents: [], children: [] };

const isLinkableTask = (task: Pick<Task, 'deletedAt' | 'purgedAt'>): boolean => (
    !task.deletedAt && !task.purgedAt
);

const normalizeLinkIdList = (value: unknown, selfId?: string): string[] => {
    if (!Array.isArray(value)) return [];
    const ids: string[] = [];
    for (const entry of value) {
        if (typeof entry !== 'string') continue;
        const id = entry.trim();
        if (!id || id === selfId || ids.includes(id)) continue;
        ids.push(id);
    }
    return ids;
};

export function normalizeTaskLinks(value: unknown, selfId?: string): TaskLinks | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as { parents?: unknown; children?: unknown };
    const parents = normalizeLinkIdList(record.parents, selfId);
    const children = normalizeLinkIdList(record.children, selfId);
    return parents.length > 0 || children.length > 0 ? { parents, children } : undefined;
}

export function getTaskLinks(task: Pick<Task, 'id' | 'links'>): TaskLinks {
    return normalizeTaskLinks(task.links, task.id) ?? { parents: [], children: [] };
}

export function unionTaskLinks(left: TaskLinks | undefined, right: TaskLinks | undefined): TaskLinks {
    const parents = [...(left?.parents ?? [])];
    for (const id of right?.parents ?? []) if (!parents.includes(id)) parents.push(id);
    const children = [...(left?.children ?? [])];
    for (const id of right?.children ?? []) if (!children.includes(id)) children.push(id);
    return { parents, children };
}

export function taskLinksEqual(left: TaskLinks | undefined, right: TaskLinks | undefined): boolean {
    const normalizedLeft = normalizeTaskLinks(left) ?? EMPTY_TASK_LINKS;
    const normalizedRight = normalizeTaskLinks(right) ?? EMPTY_TASK_LINKS;
    return normalizedLeft.parents.slice().sort().join('\u0000') === normalizedRight.parents.slice().sort().join('\u0000')
        && normalizedLeft.children.slice().sort().join('\u0000') === normalizedRight.children.slice().sort().join('\u0000');
}

export function normalizeTaskLinksForComparison(value: TaskLinks | undefined): string[] | undefined {
    const normalized = normalizeTaskLinks(value);
    if (!normalized) return undefined;
    return [
        ...normalized.parents.slice().sort().map((id) => `p:${id}`),
        ...normalized.children.slice().sort().map((id) => `c:${id}`),
    ];
}

export function buildTaskLinkIndex(tasks: readonly Task[]): TaskLinkIndex {
    const liveIds = new Set<string>();
    for (const task of tasks) if (isLinkableTask(task)) liveIds.add(task.id);

    const seen = new Set<string>();
    const edges: TaskLinkEdge[] = [];
    const parentsById = new Map<string, string[]>();
    const childrenById = new Map<string, string[]>();

    const addEdge = (parentId: string, childId: string) => {
        if (parentId === childId) return;
        if (!liveIds.has(parentId) || !liveIds.has(childId)) return;
        const key = `${parentId}\u0000${childId}`;
        if (seen.has(key)) return;
        seen.add(key);
        edges.push({ parentId, childId });
        const children = childrenById.get(parentId) ?? [];
        if (!children.includes(childId)) children.push(childId);
        childrenById.set(parentId, children);
        const parents = parentsById.get(childId) ?? [];
        if (!parents.includes(parentId)) parents.push(parentId);
        parentsById.set(childId, parents);
    };

    for (const task of tasks) {
        if (!isLinkableTask(task)) continue;
        const links = normalizeTaskLinks(task.links, task.id);
        for (const childId of links?.children ?? []) addEdge(task.id, childId);
        for (const parentId of links?.parents ?? []) addEdge(parentId, task.id);
    }

    return { edges, parentsById, childrenById };
}

export function getLinkedParentIds(index: TaskLinkIndex, taskId: string): string[] {
    return index.parentsById.get(taskId) ?? [];
}

export function getLinkedChildIds(index: TaskLinkIndex, taskId: string): string[] {
    return index.childrenById.get(taskId) ?? [];
}

export function collectLinkedIds(
    index: TaskLinkIndex,
    taskId: string,
    direction: TaskLinkDirection,
): string[] {
    const seen = new Set<string>([taskId]);
    const result: string[] = [];
    const queue = [taskId];
    while (queue.length > 0) {
        const current = queue.shift() as string;
        const nextIds = direction === 'parent'
            ? getLinkedParentIds(index, current)
            : getLinkedChildIds(index, current);
        for (const nextId of nextIds) {
            if (seen.has(nextId)) continue;
            seen.add(nextId);
            result.push(nextId);
            queue.push(nextId);
        }
    }
    return result;
}

export function isTaskLinkAncestor(
    index: TaskLinkIndex,
    candidateAncestorId: string,
    taskId: string,
): boolean {
    return collectLinkedIds(index, taskId, 'parent').includes(candidateAncestorId);
}

export function canLinkTasks(
    index: TaskLinkIndex,
    parentId: string,
    childId: string,
): 'ok' | 'self' | 'cycle' {
    if (parentId === childId) return 'self';
    if (isTaskLinkAncestor(index, childId, parentId)) return 'cycle';
    return 'ok';
}

const taskLinkPatch = (
    task: Task,
    direction: TaskLinkDirection,
    mutate: (ids: string[]) => string[],
): Partial<Task> | null => {
    const current = getTaskLinks(task);
    const nextIds = mutate(direction === 'parent' ? [...current.parents] : [...current.children]);
    const currentIds = direction === 'parent' ? current.parents : current.children;
    if (nextIds.join('\u0000') === currentIds.join('\u0000')) return null;
    const next = direction === 'parent'
        ? normalizeTaskLinks({ ...current, parents: nextIds }, task.id)
        : normalizeTaskLinks({ ...current, children: nextIds }, task.id);
    return { links: next };
};

export function buildTaskLinkUpdates(
    tasks: readonly Task[],
    input: { parentId: string; childId: string; operation: 'link' | 'unlink' },
): TaskLinkPlan {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const parent = byId.get(input.parentId);
    const child = byId.get(input.childId);
    if (!parent || !child) return { ok: false, reason: 'missing' };
    if (!isLinkableTask(parent) || !isLinkableTask(child)) return { ok: false, reason: 'deleted' };
    if (input.parentId === input.childId) return { ok: false, reason: 'self' };

    const index = buildTaskLinkIndex(tasks);
    const alreadyLinked = getLinkedChildIds(index, input.parentId).includes(input.childId);
    if (input.operation === 'link') {
        if (alreadyLinked) return { ok: true, updates: [], changed: false };
        const verdict = canLinkTasks(index, input.parentId, input.childId);
        if (verdict !== 'ok') return { ok: false, reason: verdict };
    } else if (!alreadyLinked) {
        return { ok: true, updates: [], changed: false };
    }

    const updates: TaskLinkUpdate[] = [];
    for (const task of [parent, child]) {
        const patch = input.operation === 'link'
            ? task.id === input.parentId
                ? taskLinkPatch(task, 'child', (ids) => (ids.includes(input.childId) ? ids : [...ids, input.childId]))
                : taskLinkPatch(task, 'parent', (ids) => (ids.includes(input.parentId) ? ids : [...ids, input.parentId]))
            : task.id === input.parentId
                ? taskLinkPatch(task, 'child', (ids) => ids.filter((id) => id !== input.childId))
                : taskLinkPatch(task, 'parent', (ids) => ids.filter((id) => id !== input.parentId));
        if (patch) updates.push({ id: task.id, updates: patch });
    }
    return { ok: true, updates, changed: updates.length > 0 };
}
