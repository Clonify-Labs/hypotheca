// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../../App';

describe('MCP Destekli Analiz Dashboard routing', () => {
  const originalPath = window.location.pathname;

  afterEach(() => {
    window.history.replaceState(null, '', originalPath);
    vi.restoreAllMocks();
  });

  it('renders McpDashboardPage at /dashboard and switches back to the workbench', async () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          authenticated: true,
          user: {
            username: 'zeynep.hoca',
            name: 'Prof. Dr. Zeynep Kaya',
            role: 'principal_investigator',
            bapProject: 'BAP-2026-ZEYNEP-01',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    window.history.replaceState(null, '', '/dashboard');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await act(async () => {
        root.render(<App />);
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(host.textContent).toContain('MCP Destekli BAP Analiz Dashboard');
      expect(host.textContent).toContain('bap://project/schema');
      expect(host.textContent).toContain('analyze_bap_data');
      expect(host.textContent).toContain('read_literature_pdf');
      expect(host.textContent).toContain('Prof. Dr. Zeynep Kaya');

      const workbenchBtn = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
        b.textContent?.includes('7 Adımlı Analiz Çalışma Alanına Geç'),
      )!;
      expect(workbenchBtn).toBeTruthy();

      await act(async () => {
        workbenchBtn.click();
      });
      expect(window.location.pathname).toBe('/');
      expect(host.querySelector('#np-title')).toBeTruthy();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
