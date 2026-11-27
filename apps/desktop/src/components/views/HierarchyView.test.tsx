import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskStore, type Task } from '@mindwtr/core';

import { HierarchyView } from './HierarchyView';
import { LanguageProvider } from '../../contexts/language-context';
import { useUiStore } from '../../store/ui-store';

type TaskStoreState = ReturnType<typeof useTaskStore.getState>;

const makeTask = (overrides: Partial<Task> & Pick<Task, 'id' | 'title'>): Task => ({
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
});

const seedTasks = (tasks: Task[]) => {
    useTaskStore.setState({
        _allTasks: tasks,
        projects: [] as unknown as TaskStoreState['projects'],
    });
};

const renderView = () => render(
    <LanguageProvider>
        <HierarchyView />
    </LanguageProvider>,
);

const canvas = () => document.querySelector('[data-hierarchy-canvas]');

describe('HierarchyView', () => {
    beforeEach(() => {
        useUiStore.setState({ setEditingTaskId: vi.fn() });
        seedTasks([]);
        window.localStorage.clear();
    });

    it('renders linked tasks as a hierarchy', () => {
        seedTasks([
            makeTask({ id: 'launch', title: 'Launch app', links: { parents: [], children: ['docs'] } }),
            makeTask({ id: 'docs', title: 'Write docs', links: { parents: ['launch'], children: ['polish'] } }),
            makeTask({ id: 'polish', title: 'Polish copy', links: { parents: ['docs'], children: [] } }),
        ]);

        renderView();

        expect(screen.getByRole('button', { name: 'Launch app' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Write docs' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Polish copy' })).toBeInTheDocument();
        expect(canvas()).not.toBeNull();
    });

    it('drills into a task when its node is clicked', () => {
        seedTasks([
            makeTask({ id: 'launch', title: 'Launch app', links: { parents: [], children: ['docs'] } }),
            makeTask({ id: 'docs', title: 'Write docs', links: { parents: ['launch'], children: [] } }),
        ]);

        renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Write docs' }));

        expect(screen.getByRole('combobox')).toHaveValue('docs');
        expect(screen.getByText(/Showing/)).toBeInTheDocument();
    });

    it('shows every top-level task in all-roots mode', () => {
        seedTasks([
            makeTask({ id: 'launch', title: 'Launch app', links: { parents: [], children: ['docs'] } }),
            makeTask({ id: 'docs', title: 'Write docs', links: { parents: ['launch'], children: [] } }),
            makeTask({ id: 'taxes', title: 'Pay taxes', links: { parents: [], children: ['receipts'] } }),
            makeTask({ id: 'receipts', title: 'Collect receipts', links: { parents: ['taxes'], children: [] } }),
        ]);

        renderView();
        fireEvent.change(screen.getByRole('combobox'), { target: { value: '__all__' } });

        expect(screen.getByRole('button', { name: 'Launch app' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Pay taxes' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Collect receipts' })).toBeInTheDocument();
    });

    it('shows an empty state without tasks', () => {
        renderView();

        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
        expect(
            screen.getByText('No tasks yet. Add tasks to see their hierarchy here.'),
        ).toBeInTheDocument();
    });

    it('explains that nothing is linked yet', () => {
        seedTasks([
            makeTask({ id: 'one', title: 'First task' }),
            makeTask({ id: 'two', title: 'Second task' }),
        ]);

        renderView();

        expect(
            screen.getByText('No linked tasks yet. Open a task and link a parent, subtask, or create a subtask.'),
        ).toBeInTheDocument();
        const options = within(screen.getByRole('combobox')).getAllByRole('option');
        expect(options.map((option) => option.textContent)).toEqual([
            'All top-level tasks',
            'First task',
            'Second task',
        ]);
    });
});
