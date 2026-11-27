import { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Link2, Plus, Search, X } from 'lucide-react';
import {
    buildTaskLinkIndex,
    buildTaskLinkUpdates,
    collectLinkedIds,
    getLinkedChildIds,
    getLinkedParentIds,
    tFallback,
    useTaskStore,
} from '@mindwtr/core';
import { cn } from '../../lib/utils';
import { useUiStore } from '../../store/ui-store';

type TaskLinkPickerDirection = 'parent' | 'child';

const PICKER_RESULT_LIMIT = 100;

const linkFailureLabel = (t: (key: string) => string, reason: 'missing' | 'deleted' | 'self' | 'cycle'): string => {
    if (reason === 'self') return tFallback(t, 'task.links.self', 'A task cannot be linked to itself');
    if (reason === 'cycle') return tFallback(t, 'task.links.cycle', 'That link would create a loop');
    if (reason === 'deleted') return tFallback(t, 'task.links.deleted', 'That task was deleted');
    return tFallback(t, 'task.links.missing', 'Task not found');
};

interface TaskLinksSectionProps {
    taskId?: string;
    t: (key: string) => string;
}

export function TaskLinksSection({ taskId, t }: TaskLinksSectionProps) {
    const allTasks = useTaskStore((state) => state._allTasks);
    const batchUpdateTasks = useTaskStore((state) => state.batchUpdateTasks);
    const addTask = useTaskStore((state) => state.addTask);
    const showToast = useUiStore((state) => state.showToast);
    const [pickerDirection, setPickerDirection] = useState<TaskLinkPickerDirection | null>(null);
    const [query, setQuery] = useState('');
    const [childTitle, setChildTitle] = useState('');
    const [busy, setBusy] = useState(false);

    const task = useMemo(
        () => (taskId ? allTasks.find((candidate) => candidate.id === taskId) : undefined),
        [allTasks, taskId],
    );
    const linkIndex = useMemo(() => buildTaskLinkIndex(allTasks), [allTasks]);
    const titleById = useMemo(
        () => new Map(allTasks.map((candidate) => [candidate.id, candidate.title])),
        [allTasks],
    );
    const parentIds = task ? getLinkedParentIds(linkIndex, task.id) : [];
    const childIds = task ? getLinkedChildIds(linkIndex, task.id) : [];

    const pickerCandidates = useMemo(() => {
        if (!task || !pickerDirection) return [];
        const excluded = new Set<string>([task.id]);
        if (pickerDirection === 'parent') {
            for (const id of parentIds) excluded.add(id);
            for (const id of collectLinkedIds(linkIndex, task.id, 'child')) excluded.add(id);
        } else {
            for (const id of childIds) excluded.add(id);
            for (const id of collectLinkedIds(linkIndex, task.id, 'parent')) excluded.add(id);
        }
        const needle = query.trim().toLowerCase();
        return allTasks
            .filter((candidate) => !candidate.deletedAt && !candidate.purgedAt && !excluded.has(candidate.id))
            .filter((candidate) => !needle || candidate.title.toLowerCase().includes(needle))
            .sort((left, right) => left.title.localeCompare(right.title))
            .slice(0, PICKER_RESULT_LIMIT);
    }, [allTasks, childIds, linkIndex, parentIds, pickerDirection, query, task]);

    useEffect(() => {
        if (!pickerDirection) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setPickerDirection(null);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [pickerDirection]);

    useEffect(() => {
        if (!pickerDirection) setQuery('');
    }, [pickerDirection]);

    if (!task || !taskId) return null;

    const applyLink = async (
        direction: TaskLinkPickerDirection,
        otherTaskId: string,
        operation: 'link' | 'unlink',
    ): Promise<boolean> => {
        const state = useTaskStore.getState();
        const plan = buildTaskLinkUpdates(state._allTasks, {
            parentId: direction === 'parent' ? otherTaskId : taskId,
            childId: direction === 'parent' ? taskId : otherTaskId,
            operation,
        });
        if (!plan.ok) {
            showToast(linkFailureLabel(t, plan.reason), 'error');
            return false;
        }
        if (!plan.changed) return true;
        const result = await batchUpdateTasks(plan.updates);
        if (!result.success) {
            showToast(tFallback(t, 'task.links.updateFailed', 'Could not update task links'), 'error');
            return false;
        }
        return true;
    };

    const handlePick = async (otherTaskId: string) => {
        if (!pickerDirection) return;
        setBusy(true);
        const linked = await applyLink(pickerDirection, otherTaskId, 'link');
        setBusy(false);
        if (linked) setPickerDirection(null);
    };

    const handleUnlink = async (direction: TaskLinkPickerDirection, otherTaskId: string) => {
        await applyLink(direction, otherTaskId, 'unlink');
    };

    const handleCreateChild = async () => {
        const title = childTitle.trim();
        if (!title || busy) return;
        setBusy(true);
        const created = await addTask(title, {
            status: 'next',
            ...(task.projectId ? { projectId: task.projectId } : {}),
            ...(task.areaId ? { areaId: task.areaId } : {}),
        });
        if (!created.success || !created.id) {
            showToast(tFallback(t, 'task.links.createFailed', 'Could not create the subtask'), 'error');
            setBusy(false);
            return;
        }
        await applyLink('child', created.id, 'link');
        setChildTitle('');
        setBusy(false);
    };

    const pickerLabel = pickerDirection === 'parent'
        ? tFallback(t, 'task.links.chooseParent', 'Choose a parent task')
        : tFallback(t, 'task.links.chooseChild', 'Choose a subtask');

    const groups: Array<{
        direction: TaskLinkPickerDirection;
        label: string;
        ids: string[];
        Icon: typeof ArrowUpFromLine;
        emptyLabel: string;
        actionLabel: string;
    }> = [
        {
            direction: 'parent',
            label: tFallback(t, 'task.links.parents', 'Parent tasks'),
            ids: parentIds,
            Icon: ArrowUpFromLine,
            emptyLabel: tFallback(t, 'task.links.noParents', 'No parent task linked'),
            actionLabel: tFallback(t, 'task.links.linkParent', 'Link parent'),
        },
        {
            direction: 'child',
            label: tFallback(t, 'task.links.children', 'Subtasks'),
            ids: childIds,
            Icon: ArrowDownToLine,
            emptyLabel: tFallback(t, 'task.links.noChildren', 'No subtask linked'),
            actionLabel: tFallback(t, 'task.links.linkChild', 'Link subtask'),
        },
    ];

    return (
        <div className="space-y-3 border-t border-border pt-3" data-task-links-section>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                {tFallback(t, 'task.links.title', 'Task hierarchy')}
            </div>
            {groups.map(({ direction, label, ids, Icon, emptyLabel, actionLabel }) => (
                <div key={direction} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                            {label}
                        </span>
                        <button
                            type="button"
                            onClick={() => setPickerDirection(direction)}
                            className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        >
                            <Plus className="h-3 w-3" aria-hidden="true" />
                            {actionLabel}
                        </button>
                    </div>
                    {ids.length === 0 ? (
                        <p className="text-xs text-muted-foreground/70">{emptyLabel}</p>
                    ) : (
                        <ul className="flex flex-wrap gap-1.5">
                            {ids.map((id) => (
                                <li key={id}>
                                    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/40 py-0.5 pl-2.5 pr-1 text-xs text-foreground">
                                        <span className="max-w-[18rem] truncate">{titleById.get(id) ?? id}</span>
                                        <button
                                            type="button"
                                            onClick={() => void handleUnlink(direction, id)}
                                            aria-label={tFallback(t, 'task.links.unlink', 'Remove link')}
                                            title={tFallback(t, 'task.links.unlink', 'Remove link')}
                                            className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                                        >
                                            <X className="h-3 w-3" aria-hidden="true" />
                                        </button>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            ))}
            <div className="flex items-center gap-2">
                <input
                    value={childTitle}
                    onChange={(event) => setChildTitle(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            void handleCreateChild();
                        }
                    }}
                    placeholder={tFallback(t, 'task.links.newSubtaskPlaceholder', 'New subtask title')}
                    aria-label={tFallback(t, 'task.links.newSubtaskPlaceholder', 'New subtask title')}
                    className="min-w-0 flex-1 rounded border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <button
                    type="button"
                    disabled={!childTitle.trim() || busy}
                    onClick={() => void handleCreateChild()}
                    className="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                    <Plus className="h-3 w-3" aria-hidden="true" />
                    {tFallback(t, 'task.links.createSubtask', 'Create subtask')}
                </button>
            </div>
            {pickerDirection && (
                <div
                    className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-24"
                    role="dialog"
                    aria-modal="true"
                    aria-label={pickerLabel}
                    onClick={() => setPickerDirection(null)}
                >
                    <div
                        className="flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-border px-3 py-2">
                            <span className="text-sm font-medium text-popover-foreground">{pickerLabel}</span>
                            <button
                                type="button"
                                onClick={() => setPickerDirection(null)}
                                aria-label={tFallback(t, 'common.close', 'Close')}
                                className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted/40 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                            >
                                <X className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                        </div>
                        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                            <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                            <input
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') event.preventDefault();
                                }}
                                autoFocus
                                placeholder={tFallback(t, 'common.search', 'Search...')}
                                aria-label={tFallback(t, 'common.search', 'Search...')}
                                className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                            />
                        </div>
                        <ul className="min-h-0 flex-1 overflow-y-auto py-1">
                            {pickerCandidates.length === 0 ? (
                                <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                                    {tFallback(t, 'common.noMatches', 'No matches')}
                                </li>
                            ) : pickerCandidates.map((candidate) => (
                                <li key={candidate.id}>
                                    <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => void handlePick(candidate.id)}
                                        className={cn(
                                            'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-popover-foreground transition-colors hover:bg-muted/40 disabled:opacity-60',
                                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40',
                                        )}
                                    >
                                        <span className="min-w-0 truncate">{candidate.title}</span>
                                        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                                            {t(`status.${candidate.status}`)}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
}
