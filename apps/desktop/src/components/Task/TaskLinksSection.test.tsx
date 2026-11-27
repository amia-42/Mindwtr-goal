import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskStore, type Task } from '@mindwtr/core';

import { TaskLinksSection } from './TaskLinksSection';
import { useUiStore } from '../../store/ui-store';

type TaskStoreState = ReturnType<typeof useTaskStore.getState>;

const t = (key: string) => key;

const makeTask = (overrides: Partial<Task> & Pick<Task, 'id' | 'title'>): Task => ({
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
});

type BatchUpdates = Array<{ id: string; updates: Partial<Task> }>;

const batchUpdateTasks = vi.fn(async (_updates: BatchUpdates) => ({ success: true }));
const addTask = vi.fn(async (_title: string, _initialProps?: Partial<Task>) => ({ success: true, id: 'new-task' }));

const seedTasks = (tasks: Task[]) => {
    useTaskStore.setState({
        _allTasks: tasks,
        batchUpdateTasks: batchUpdateTasks as unknown as TaskStoreState['batchUpdateTasks'],
        addTask: addTask as unknown as TaskStoreState['addTask'],
    });
};

const lastBatch = (): BatchUpdates => {
    const calls = batchUpdateTasks.mock.calls;
    return calls.length > 0 ? calls[calls.length - 1][0] : [];
};

const linksFor = (updates: BatchUpdates, id: string) => updates.find((update) => update.id === id)?.updates;

describe('TaskLinksSection', () => {
    beforeEach(() => {
        batchUpdateTasks.mockClear();
        addTask.mockClear();
        useUiStore.setState({ showToast: vi.fn() });
        seedTasks([]);
    });

    it('shows linked parents and subtasks as chips', () => {
        seedTasks([
            makeTask({ id: 'parent-1', title: 'Ship release' }),
            makeTask({ id: 'child-1', title: 'Write changelog', links: { parents: ['parent-1'], children: ['sub-1'] } }),
            makeTask({ id: 'sub-1', title: 'Draft notes', links: { parents: ['child-1'], children: [] } }),
        ]);

        render(<TaskLinksSection taskId="child-1" t={t} />);

        expect(screen.getByText('Ship release')).toBeInTheDocument();
        expect(screen.getByText('Draft notes')).toBeInTheDocument();
        expect(screen.queryByText('No parent task linked')).not.toBeInTheDocument();
        expect(screen.queryByText('No subtask linked')).not.toBeInTheDocument();
    });

    it('links a chosen task as a parent from both sides', async () => {
        seedTasks([
            makeTask({ id: 'child-1', title: 'Write changelog' }),
            makeTask({ id: 'other-1', title: 'Archive invoices' }),
        ]);

        render(<TaskLinksSection taskId="child-1" t={t} />);
        fireEvent.click(screen.getByRole('button', { name: 'Link parent' }));

        const dialog = screen.getByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: /Archive invoices/ }));

        await waitFor(() => expect(batchUpdateTasks).toHaveBeenCalledTimes(1));
        const updates = lastBatch();
        expect(linksFor(updates, 'child-1')?.links?.parents).toEqual(['other-1']);
        expect(linksFor(updates, 'other-1')?.links?.children).toEqual(['child-1']);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('removes a link and clears the stored array', async () => {
        seedTasks([
            makeTask({ id: 'parent-1', title: 'Ship release', links: { parents: [], children: ['child-1'] } }),
            makeTask({ id: 'child-1', title: 'Write changelog', links: { parents: ['parent-1'], children: [] } }),
        ]);

        render(<TaskLinksSection taskId="child-1" t={t} />);
        fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));

        await waitFor(() => expect(batchUpdateTasks).toHaveBeenCalledTimes(1));
        const updates = lastBatch();
        expect(linksFor(updates, 'child-1')?.links).toBeUndefined();
        expect(linksFor(updates, 'parent-1')?.links).toBeUndefined();
    });

    it('excludes the task and its subtasks from the parent picker', () => {
        seedTasks([
            makeTask({ id: 'root-1', title: 'Root task', links: { parents: [], children: ['mid-1'] } }),
            makeTask({ id: 'mid-1', title: 'Middle task', links: { parents: ['root-1'], children: ['leaf-1'] } }),
            makeTask({ id: 'leaf-1', title: 'Leaf task', links: { parents: ['mid-1'], children: [] } }),
            makeTask({ id: 'free-1', title: 'Unlinked task' }),
        ]);

        render(<TaskLinksSection taskId="root-1" t={t} />);
        fireEvent.click(screen.getByRole('button', { name: 'Link parent' }));

        const dialog = screen.getByRole('dialog');
        expect(within(dialog).queryByText('Middle task')).not.toBeInTheDocument();
        expect(within(dialog).queryByText('Leaf task')).not.toBeInTheDocument();
        expect(within(dialog).getByText('Unlinked task')).toBeInTheDocument();
    });

    it('creates a subtask and links it to the current task', async () => {
        seedTasks([makeTask({ id: 'parent-1', title: 'Ship release', projectId: 'proj-1' })]);

        addTask.mockImplementationOnce(async (title: string, initialProps?: Partial<Task>) => {
            const created = makeTask({ id: 'new-task', title, ...initialProps });
            useTaskStore.setState({ _allTasks: [...useTaskStore.getState()._allTasks, created] });
            return { success: true, id: 'new-task' };
        });

        render(<TaskLinksSection taskId="parent-1" t={t} />);
        fireEvent.change(screen.getByLabelText('New subtask title'), { target: { value: 'Plan launch' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create subtask' }));

        await waitFor(() => expect(batchUpdateTasks).toHaveBeenCalledTimes(1));
        expect(addTask).toHaveBeenCalledWith('Plan launch', expect.objectContaining({ status: 'next', projectId: 'proj-1' }));
        const updates = lastBatch();
        expect(linksFor(updates, 'parent-1')?.links?.children).toEqual(['new-task']);
        expect(linksFor(updates, 'new-task')?.links?.parents).toEqual(['parent-1']);
    });
});
