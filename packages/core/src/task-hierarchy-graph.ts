import {
    buildTaskLinkIndex,
    getLinkedChildIds,
    getLinkedParentIds,
    type TaskLinkEdge,
} from './task-links';
import type { Task } from './types';

export type TaskHierarchyNode = {
    id: string;
    task: Task;
    parentIds: string[];
    childIds: string[];
};

export type TaskHierarchyGraph = {
    nodes: Map<string, TaskHierarchyNode>;
    order: string[];
    roots: string[];
    edges: TaskLinkEdge[];
};

export const HIERARCHY_NODE_WIDTH = 232;
export const HIERARCHY_NODE_HEIGHT = 72;
export const HIERARCHY_H_GAP = 28;
export const HIERARCHY_V_GAP = 76;

export type HierarchyLayoutNode = {
    id: string;
    depth: number;
    slot: number;
    x: number;
    y: number;
    width: number;
    height: number;
};

export type HierarchyLayoutEdge = {
    parentId: string;
    childId: string;
    crossLink: boolean;
    from: { x: number; y: number };
    to: { x: number; y: number };
};

export type TaskHierarchyLayout = {
    rootId: string;
    nodes: HierarchyLayoutNode[];
    byId: Map<string, HierarchyLayoutNode>;
    edges: HierarchyLayoutEdge[];
    width: number;
    height: number;
    maxDepth: number;
};

export function buildTaskHierarchyGraph(tasks: readonly Task[]): TaskHierarchyGraph {
    const index = buildTaskLinkIndex(tasks);
    const nodes = new Map<string, TaskHierarchyNode>();
    const order: string[] = [];
    for (const task of tasks) {
        if (task.deletedAt || task.purgedAt) continue;
        if (nodes.has(task.id)) continue;
        nodes.set(task.id, {
            id: task.id,
            task,
            parentIds: getLinkedParentIds(index, task.id),
            childIds: getLinkedChildIds(index, task.id),
        });
        order.push(task.id);
    }
    const roots = order.filter((id) => (nodes.get(id)?.parentIds.length ?? 0) === 0);
    return { nodes, order, roots, edges: index.edges };
}

export function collectHierarchyIds(graph: TaskHierarchyGraph, rootId: string): string[] {
    if (!graph.nodes.has(rootId)) return [];
    const seen = new Set<string>([rootId]);
    const ids = [rootId];
    const queue = [rootId];
    while (queue.length > 0) {
        const current = queue.shift() as string;
        for (const childId of graph.nodes.get(current)?.childIds ?? []) {
            if (seen.has(childId) || !graph.nodes.has(childId)) continue;
            seen.add(childId);
            ids.push(childId);
            queue.push(childId);
        }
    }
    return ids;
}

export function getHierarchyAncestorPath(graph: TaskHierarchyGraph, taskId: string): string[] {
    if (!graph.nodes.has(taskId)) return [];
    const seen = new Set<string>([taskId]);
    const path: string[] = [];
    let current = taskId;
    for (;;) {
        const parentId = (graph.nodes.get(current)?.parentIds ?? [])[0];
        if (!parentId || seen.has(parentId) || !graph.nodes.has(parentId)) break;
        seen.add(parentId);
        path.push(parentId);
        current = parentId;
    }
    return path.reverse();
}

export function findHierarchyTopRoot(graph: TaskHierarchyGraph, taskId: string): string {
    const path = getHierarchyAncestorPath(graph, taskId);
    return path[0] ?? taskId;
}

export function findDefaultHierarchyRoot(graph: TaskHierarchyGraph): string | null {
    for (const id of graph.order) {
        const node = graph.nodes.get(id);
        if (!node) continue;
        if (node.parentIds.length === 0 && node.childIds.length > 0) return id;
    }
    return graph.roots[0] ?? null;
}

export type HierarchyLayoutOptions = {
    nodeWidth?: number;
    nodeHeight?: number;
    horizontalGap?: number;
    verticalGap?: number;
};

export function layoutTaskHierarchyGraph(
    graph: TaskHierarchyGraph,
    rootId: string,
    options: HierarchyLayoutOptions = {},
): TaskHierarchyLayout {
    const nodeWidth = options.nodeWidth ?? HIERARCHY_NODE_WIDTH;
    const nodeHeight = options.nodeHeight ?? HIERARCHY_NODE_HEIGHT;
    const horizontalGap = options.horizontalGap ?? HIERARCHY_H_GAP;
    const verticalGap = options.verticalGap ?? HIERARCHY_V_GAP;
    const orderIndex = new Map(graph.order.map((id, index) => [id, index]));
    const visibleIds = collectHierarchyIds(graph, rootId);
    const visible = new Set(visibleIds);

    const primaryParent = new Map<string, string>();
    const depthById = new Map<string, number>([[rootId, 0]]);
    const primaryChildren = new Map<string, string[]>();
    const queue = [rootId];
    while (queue.length > 0) {
        const current = queue.shift() as string;
        const children = [...(graph.nodes.get(current)?.childIds ?? [])]
            .filter((childId) => visible.has(childId))
            .sort((left, right) => (orderIndex.get(left) ?? 0) - (orderIndex.get(right) ?? 0));
        for (const childId of children) {
            if (childId === rootId || primaryParent.has(childId)) continue;
            primaryParent.set(childId, current);
            depthById.set(childId, (depthById.get(current) ?? 0) + 1);
            queue.push(childId);
        }
    }
    for (const [childId, parentId] of primaryParent) {
        const list = primaryChildren.get(parentId) ?? [];
        list.push(childId);
        primaryChildren.set(parentId, list);
    }

    const slotById = new Map<string, number>();
    let nextSlot = 0;
    const assignSlot = (id: string): number => {
        const children = primaryChildren.get(id) ?? [];
        if (children.length === 0) {
            const slot = nextSlot;
            nextSlot += 1;
            slotById.set(id, slot);
            return slot;
        }
        const childSlots = children.map(assignSlot);
        const slot = childSlots.length === 1
            ? childSlots[0]
            : (Math.min(...childSlots) + Math.max(...childSlots)) / 2;
        slotById.set(id, slot);
        return slot;
    };
    assignSlot(rootId);

    const layoutNodes: HierarchyLayoutNode[] = visibleIds.map((id) => {
        const slot = slotById.get(id) ?? 0;
        const depth = depthById.get(id) ?? 0;
        return {
            id,
            depth,
            slot,
            x: slot * (nodeWidth + horizontalGap),
            y: depth * (nodeHeight + verticalGap),
            width: nodeWidth,
            height: nodeHeight,
        };
    });
    const byId = new Map(layoutNodes.map((node) => [node.id, node]));

    const layoutEdges: HierarchyLayoutEdge[] = [];
    for (const edge of graph.edges) {
        if (!visible.has(edge.parentId) || !visible.has(edge.childId)) continue;
        const from = byId.get(edge.parentId);
        const to = byId.get(edge.childId);
        if (!from || !to) continue;
        layoutEdges.push({
            parentId: edge.parentId,
            childId: edge.childId,
            crossLink: primaryParent.get(edge.childId) !== edge.parentId,
            from: { x: from.x + from.width / 2, y: from.y + from.height },
            to: { x: to.x + to.width / 2, y: to.y },
        });
    }

    const maxSlot = layoutNodes.reduce((max, node) => Math.max(max, node.slot), 0);
    const maxDepth = layoutNodes.reduce((max, node) => Math.max(max, node.depth), 0);
    const width = (maxSlot + 1) * (nodeWidth + horizontalGap) + horizontalGap;
    const height = (maxDepth + 1) * (nodeHeight + verticalGap) + verticalGap;
    return { rootId, nodes: layoutNodes, byId, edges: layoutEdges, width, height, maxDepth };
}
