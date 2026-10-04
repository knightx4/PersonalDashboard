import { describe, expect, it } from 'vitest';
import {
  captureFiling,
  capturePartLabel,
  filedDestination,
  filedMessage,
  offeredCapturePlaces,
  type FiledCapture,
} from '@/lib/capture/place';
import type { CaptureSort } from '@/lib/capture/sort';

/**
 * The one capture box (plan #1581): which places it offers, how the line
 * under the field names a part, what Enter files given what the box showed,
 * and how it names where each thing went.
 */

const GOAL = { id: '00000000-0000-4000-8000-000000000001', title: 'Run a half marathon' };
const ROLE = { id: '00000000-0000-4000-8000-000000000002', title: 'Product Analyst', company: 'Stripe' };

const sure: CaptureSort = {
  parts: [{ place: 'goals', text: 'ran 10k this morning', goal: GOAL, role: null }],
  confidence: 0.9,
  sure: true,
};
const unsure: CaptureSort = {
  parts: [{ place: 'jobs', text: 'Stripe called', goal: null, role: ROLE }],
  confidence: 0.6,
  sure: false,
};

describe('the places the box offers', () => {
  it('leaves the vault out until notes can be written there', () => {
    expect(offeredCapturePlaces(undefined)).toEqual(['todo', 'goals', 'jobs']);
    expect(offeredCapturePlaces(['todo', 'vault'])).toEqual(['todo']);
  });

  it('offers only the workspaces an account has', () => {
    expect(offeredCapturePlaces(['todo', 'jobs'])).toEqual(['todo', 'jobs']);
  });
});

describe('the line under the field', () => {
  it('names the goal or the role a part goes to', () => {
    expect(capturePartLabel(sure.parts[0])).toBe('Update a goal · Run a half marathon');
    expect(capturePartLabel(unsure.parts[0])).toBe('Note on a job · Product Analyst at Stripe');
    expect(capturePartLabel({ place: 'todo', goal: null, role: null })).toBe('Add a todo');
  });
});

describe('what Enter files', () => {
  it('files a sure sort as it was shown', () => {
    expect(captureFiling('ran 10k this morning', sure, null)).toEqual({ kind: 'file', parts: sure.parts });
  });

  it('asks rather than filing an unsure sort', () => {
    expect(captureFiling('Stripe called', unsure, null)).toEqual({ kind: 'ask' });
  });

  it('sorts first when the box had no answer yet', () => {
    expect(captureFiling('call mum', null, null)).toEqual({ kind: 'sort' });
  });

  it('files the whole sentence where the person picked, keeping the role the sort named', () => {
    expect(captureFiling(' Stripe called ', unsure, 'jobs')).toEqual({
      kind: 'file',
      parts: [{ place: 'jobs', text: 'Stripe called', goal: null, role: ROLE }],
    });
    expect(captureFiling('Stripe called', unsure, 'todo')).toEqual({
      kind: 'file',
      parts: [{ place: 'todo', text: 'Stripe called', goal: null, role: null }],
    });
  });
});

describe('where each thing went', () => {
  it('names the workspace and what inside it', () => {
    expect(filedDestination('todo', {})).toEqual({ module: 'todo', href: '/todo', name: 'Todo · Today' });
    expect(filedDestination('jobs', { role: ROLE })?.name).toBe('Job search · Product Analyst at Stripe');
    expect(filedDestination('goals', { entries: [] })?.name).toBe('Goals · Home');
  });

  it('says one place by name and several by count', () => {
    const one = { where: 'Todo · Today' } as FiledCapture;
    expect(filedMessage([one])).toBe('Filed in Todo · Today.');
    expect(filedMessage([one, one])).toBe('Filed in 2 places.');
    expect(filedMessage([])).toBe('');
  });
});
