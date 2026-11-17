// @vitest-environment jsdom
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import App from '../App';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function setInput(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('App shell smoke test', () => {
  it('creates a project, picks data and renders every step and tool without throwing', async () => {
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const mem = new Map<string, string>();
    const memStorage = {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, String(v)),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: (i: number) => Array.from(mem.keys())[i] ?? null,
      get length() {
        return mem.size;
      },
    };
    Object.defineProperty(window, 'localStorage', { value: memStorage, configurable: true });
    window.localStorage.clear();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const errors: unknown[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args[0]);
    };
    try {
      await act(async () => {
        root.render(<App />);
      });
      expect(host.querySelector('.hp-brand-name')?.textContent).toBe('Hypotheca');

      // Empty project list shows the creation form; a too-short title cannot be submitted.
      const titleInput = host.querySelector<HTMLInputElement>('#np-title')!;
      const submit = host.querySelector<HTMLButtonElement>('form button[type="submit"]')!;
      await act(async () => setInput(titleInput, 'ab'));
      expect(submit.disabled).toBe(true);
      await act(async () => setInput(titleInput, 'Öz-yeterlik ve tükenmişlik'));
      expect(submit.disabled).toBe(false);
      await act(async () => submit.click());

      const navButtons = () => Array.from(host.querySelectorAll<HTMLButtonElement>('.hp-nav-btn'));
      expect(navButtons().length).toBe(10);

      // Steps that need data show a gate until a dataset is chosen.
      await act(async () => navButtons()[3].click());
      expect(host.textContent).toMatch(/önce bir veri seti seçin/);

      await act(async () => navButtons()[1].click());
      const selectBtn = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Seç')!;
      await act(async () => selectBtn.click());
      expect(navButtons()[1].classList.contains('is-done')).toBe(true);

      for (let i = 0; i < navButtons().length; i++) {
        const btn = navButtons()[i];
        await act(async () => {
          btn.click();
        });
        expect(navButtons()[i].getAttribute('aria-current')).toBe('page');
        expect(host.querySelector('.hp-main-inner')?.children.length).toBeGreaterThan(1);
      }

      // Project is persisted.
      const stored = JSON.parse(window.localStorage.getItem('hypotheca.projects.v1') || '[]');
      expect(stored).toHaveLength(1);
      expect(stored[0].datasetId).toBeTruthy();
    } finally {
      console.error = origError;
      await act(async () => root.unmount());
      host.remove();
    }
    const fatal = errors.filter((e) => String(e).includes('The above error occurred') || String(e).includes('Uncaught'));
    expect(fatal).toEqual([]);
  });

  it('launches a sample study, records an analysis, pre-fills reporting/sharing and allows analysis removal', async () => {
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const mem = new Map<string, string>();
    const memStorage = {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, String(v)),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: (i: number) => Array.from(mem.keys())[i] ?? null,
      get length() {
        return mem.size;
      },
    };
    Object.defineProperty(window, 'localStorage', { value: memStorage, configurable: true });
    window.localStorage.clear();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(<App />);
      });
      const sampleBtn = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
        b.textContent?.includes('Örnek çalışmayla dene'),
      )!;
      expect(sampleBtn).toBeTruthy();
      await act(async () => sampleBtn.click());

      const navButtons = () => Array.from(host.querySelectorAll<HTMLButtonElement>('.hp-nav-btn'));
      expect(navButtons()[0].classList.contains('is-done')).toBe(true);
      expect(navButtons()[1].classList.contains('is-done')).toBe(true);
      expect(navButtons()[3].getAttribute('aria-current')).toBe('page');

      // Step 5 (Classical analysis): run default t-test
      await act(async () => navButtons()[4].click());
      const runBtn = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === 'Çalıştır')!;
      await act(async () => runBtn.click());
      expect(navButtons()[4].classList.contains('is-done')).toBe(true);
      expect(host.textContent).toContain('1 analiz');

      // Step 6 (Publication): project title appears in manuscript + chip list allows removal
      await act(async () => navButtons()[5].click());
      expect(host.textContent).toContain('Akademik Öz-Yeterlik ve Tükenmişlik');
      const removeChip = host.querySelector<HTMLButtonElement>('button[aria-label*="analizini çıkar"]')!;
      expect(removeChip).toBeTruthy();
      await act(async () => removeChip.click());
      expect(navButtons()[4].classList.contains('is-done')).toBe(false);

      // Step 7 (Sharing): research question pre-fills prereg notes
      await act(async () => navButtons()[6].click());
      const notesArea = host.querySelector<HTMLTextAreaElement>('textarea')!;
      expect(notesArea.value).toContain('Araştırma sorusu:');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
