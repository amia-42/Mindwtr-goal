import { useMemo } from 'react';
import { ArrowUpRight, GitBranch, Layers, ListTree } from 'lucide-react';
import {
    buildTaskHierarchyGraph,
    findDefaultHierarchyRoot,
    getHierarchyAncestorPath,
    layoutTaskHierarchyGraph,
    tFallback,
    useTaskStore,
    type HierarchyLayoutEdge,
    type TaskHierarchyLayout,
} from '@mindwtr/core';
import { useLanguage } from '../../contexts/language-context';
import { usePersistedViewState } from '../../hooks/usePersistedViewState';
import { cn } from '../../lib/utils';
import { useUiStore } from '../../store/ui-store';

const HIERARCHY_VIEW_STATE_STORAGE_KEY = 'mindwtr:view:hierarchy:v1';
const HIERARCHY_BLOCK_GAP = 48;
const ALL_ROOTS_OPTION = '__all__';

type HierarchyViewMode = 'single' | 'all';

type HierarchyPersistedViewState = {
    rootId: string | null;
    mode: HierarchyViewMode;
};

const DEFAULT_HIERARCHY_VIEW_STATE: HierarchyPersistedViewState = {
    rootId: null,
    mode: 'single',
};

function sanitizeHierarchyViewState(value: unknown, fallback: HierarchyPersistedViewState): HierarchyPersistedViewState {
    const parsed = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Partial<HierarchyPersistedViewState>
        : {};
    return {
        rootId: typeof parsed.rootId === 'string' && parsed.rootId.trim() ? parsed.rootId : fallback.rootId,
        mode: parsed.mode === 'all' || parsed.mode === 'single' ? parsed.mode : fallback.mode,
    };
}

const STATUS_DOT_CLASS: Record<string, string> = {
    inbox: 'bg-sky-500',
    next: 'bg-blue-500',
    waiting: 'bg-amber-500',
    someday: 'bg-violet-500',
    reference: 'bg-slate-400',
    done: 'bg-emerald-500',
    archived: 'bg-zinc-400',
};

const edgePath = (edge: HierarchyLayoutEdge): string => {
    const { from, to } = edge;
    const midY = from.y + Math.max(24, (to.y - from.y) / 2);
    return `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`;
};

export function HierarchyView() {
    const { t } = useLanguage();
    const tasks = useTaskStore((state) => state._allTasks);
    const projects = useTaskStore((state) => state.projects);
    const setEditingTaskId = useUiStore((state) => state.setEditingTaskId);
    const [viewState, setViewState] = usePersistedViewState<HierarchyPersistedViewState>(
        HIERARCHY_VIEW_STATE_STORAGE_KEY,
        DEFAULT_HIERARCHY_VIEW_STATE,
        sanitizeHierarchyViewState,
    );

    const graph = useMemo(() => buildTaskHierarchyGraph(tasks), [tasks]);
    const projectNameById = useMemo(
        () => new Map(projects.map((project) => [project.id, project.title])),
        [projects],
    );
    const defaultRootId = useMemo(() => findDefaultHierarchyRoot(graph), [graph]);
    const selectedRootId = viewState.rootId && graph.nodes.has(viewState.rootId)
        ? viewState.rootId
        : defaultRootId;

    const blocks = useMemo(() => {
        if (viewState.mode === 'all') {
            return graph.roots.map((rootId) => layoutTaskHierarchyGraph(graph, rootId));
        }
        return selectedRootId ? [layoutTaskHierarchyGraph(graph, selectedRootId)] : [];
    }, [graph, selectedRootId, viewState.mode]);

    const offsetById = useMemo(() => {
        const offsets = new Map<string, number>();
        let offset = 0;
        for (const block of blocks) {
            offsets.set(block.rootId, offset);
            offset += block.height + HIERARCHY_BLOCK_GAP;
        }
        return offsets;
    }, [blocks]);

    const canvasWidth = blocks.reduce((width, block) => Math.max(width, block.width), 0);
    const canvasHeight = blocks.reduce((height, block) => height + block.height + HIERARCHY_BLOCK_GAP, 0);

    const selectValue = viewState.mode === 'all' ? ALL_ROOTS_OPTION : (selectedRootId ?? '');
    const rootOptions = selectedRootId && !graph.roots.includes(selectedRootId)
        ? [...graph.roots, selectedRootId]
        : graph.roots;
    const linkedRootTitle = selectedRootId ? graph.nodes.get(selectedRootId)?.task.title : undefined;
    const breadcrumb = selectedRootId && viewState.mode === 'single'
        ? [...getHierarchyAncestorPath(graph, selectedRootId), selectedRootId]
        : [];

    const handleSelectRoot = (value: string) => {
        if (value === ALL_ROOTS_OPTION) {
            setViewState((current) => ({ ...current, mode: 'all' }));
            return;
        }
        setViewState((current) => ({ ...current, mode: 'single', rootId: value || null }));
    };

    const showBlock = (block: TaskHierarchyLayout, offset: number) => {
        return (
            <div key={`${block.rootId}-${offset}`} className="absolute left-0" style={{ top: offset }}>
                <svg
                    width={Math.max(block.width, 1)}
                    height={Math.max(block.height, 1)}
                    aria-hidden="true"
                    className="pointer-events-none absolute left-0 top-0 overflow-visible"
                >
                    {block.edges.map((edge, index) => (
                        <path
                            key={`${edge.parentId}-${edge.childId}-${index}`}
                            d={edgePath(edge)}
                            fill="none"
                            strokeWidth={edge.crossLink ? 1.25 : 1.5}
                            strokeDasharray={edge.crossLink ? '5 4' : undefined}
                            className={edge.crossLink ? 'stroke-muted-foreground/50' : 'stroke-border'}
                            strokeLinecap="round"
                        />
                    ))}
                </svg>
                {block.nodes.map((node) => {
                    const task = graph.nodes.get(node.id)?.task;
                    if (!task) return null;
                    const projectName = task.projectId ? projectNameById.get(task.projectId) : undefined;
                    return (
                        <div
                            key={node.id}
                            className="group absolute"
                            style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
                        >
                            <div
                                className={cn(
                                    'flex h-full flex-col justify-between rounded-lg border border-border bg-card px-3 py-2 shadow-sm transition-colors',
                                    'hover:border-primary/50',
                                    node.id === block.rootId && 'border-primary/40',
                                )}
                            >
                                <button
                                    type="button"
                                    onClick={() => handleSelectRoot(node.id)}
                                    className="line-clamp-2 text-left text-sm font-medium leading-snug text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                                    title={task.title}
                                >
                                    {task.title}
                                </button>
                                <div className="flex items-center justify-between gap-2 pr-5">
                                    <span className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
                                        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT_CLASS[task.status] ?? 'bg-slate-400')} />
                                        <span className="truncate">{t(`status.${task.status}`)}</span>
                                    </span>
                                    {projectName && (
                                        <span className="max-w-[6rem] truncate text-[10px] text-muted-foreground/80">{projectName}</span>
                                    )}
                                    {node.id !== block.rootId && (
                                        <span className="shrink-0 text-[10px] text-muted-foreground/70">
                                            {graph.nodes.get(node.id)?.childIds.length ?? 0}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setEditingTaskId(task.id)}
                                aria-label={tFallback(t, 'task.hierarchy.openTask', 'Open task')}
                                title={tFallback(t, 'task.hierarchy.openTask', 'Open task')}
                                className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted/60 hover:text-foreground focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 group-hover:opacity-100"
                            >
                                <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                            </button>
                        </div>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="h-full px-4 pt-3">
            <div className="mx-auto w-full min-w-0 max-w-screen-2xl">
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="min-w-0">
                        <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
                            <ListTree className="h-5 w-5 text-primary" aria-hidden="true" />
                            {tFallback(t, 'task.hierarchy.title', 'Task hierarchy')}
                        </h1>
                        <p className="mt-1 text-xs text-muted-foreground">
                            {tFallback(
                                t,
                                'task.hierarchy.description',
                                'Directed graph of linked tasks. Click a task to make it the root, or open it to edit.',
                            )}
                        </p>
                    </div>
                    {graph.order.length > 0 && (
                        <label className="flex min-w-0 flex-col gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                            {tFallback(t, 'task.hierarchy.rootLabel', 'Top-level task')}
                            <select
                                value={selectValue}
                                onChange={(event) => handleSelectRoot(event.target.value)}
                                className="min-w-[14rem] max-w-[22rem] rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                            >
                                <option value={ALL_ROOTS_OPTION}>
                                    {tFallback(t, 'task.hierarchy.allRoots', 'All top-level tasks')}
                                </option>
                                {rootOptions.map((rootId) => (
                                    <option key={rootId} value={rootId}>
                                        {graph.nodes.get(rootId)?.task.title ?? rootId}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}
                </div>

                {breadcrumb.length > 1 && viewState.mode === 'single' && (
                    <nav aria-label={tFallback(t, 'task.hierarchy.breadcrumb', 'Hierarchy path')} className="mt-3 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        {breadcrumb.map((id, index) => {
                            const isLast = index === breadcrumb.length - 1;
                            return (
                                <span key={id} className="flex items-center gap-1">
                                    {index > 0 && <span aria-hidden="true">/</span>}
                                    {isLast ? (
                                        <span className="font-medium text-foreground">{graph.nodes.get(id)?.task.title ?? id}</span>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => handleSelectRoot(id)}
                                            className="rounded px-1 py-0.5 hover:bg-muted/40 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                                        >
                                            {graph.nodes.get(id)?.task.title ?? id}
                                        </button>
                                    )}
                                </span>
                            );
                        })}
                    </nav>
                )}

                {graph.order.length === 0 ? (
                    <div className="mt-6 rounded-lg border border-dashed border-border px-6 py-12 text-center">
                        <GitBranch className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
                        <p className="mt-3 text-sm text-muted-foreground">
                            {tFallback(t, 'task.hierarchy.empty', 'No tasks yet. Add tasks to see their hierarchy here.')}
                        </p>
                    </div>
                ) : graph.edges.length === 0 ? (
                    <div className="mt-6 rounded-lg border border-dashed border-border px-6 py-12 text-center">
                        <Layers className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
                        <p className="mt-3 text-sm text-muted-foreground">
                            {tFallback(
                                t,
                                'task.hierarchy.noLinks',
                                'No linked tasks yet. Open a task and link a parent, subtask, or create a subtask.',
                            )}
                        </p>
                    </div>
                ) : (
                    <div className="mt-3 overflow-auto rounded-lg border border-border bg-muted/20" data-hierarchy-canvas>
                        <div
                            className="relative"
                            style={{
                                width: Math.max(canvasWidth + 24, 1),
                                height: Math.max(canvasHeight + 24, 1),
                            }}
                        >
                            {blocks.map((block) => showBlock(block, offsetById.get(block.rootId) ?? 0))}
                        </div>
                    </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-4 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                        <svg width="28" height="6" aria-hidden="true">
                            <line x1="0" y1="3" x2="28" y2="3" className="stroke-border" strokeWidth="1.5" />
                        </svg>
                        {tFallback(t, 'task.hierarchy.primaryEdge', 'Parent to subtask')}
                    </span>
                    <span className="flex items-center gap-1.5">
                        <svg width="28" height="6" aria-hidden="true">
                            <line x1="0" y1="3" x2="28" y2="3" className="stroke-muted-foreground/50" strokeWidth="1.25" strokeDasharray="5 4" />
                        </svg>
                        {tFallback(t, 'task.hierarchy.crossEdge', 'Additional parent')}
                    </span>
                    {linkedRootTitle && viewState.mode === 'single' && (
                        <span>
                            {tFallback(t, 'task.hierarchy.viewingRoot', 'Showing')}: {linkedRootTitle}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
