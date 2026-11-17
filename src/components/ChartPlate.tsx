import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { StatChart } from '../types/interfaces';

export interface ChartPlateProps {
  chart: StatChart;
  height?: number;
}

function readTokenColor(name: string, fallbackVar: string): string {
  const styles = getComputedStyle(document.documentElement);
  const v = styles.getPropertyValue(name).trim();
  return v || styles.getPropertyValue(fallbackVar).trim();
}

export const ChartPlate: React.FC<ChartPlateProps> = ({ chart, height = 310 }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return;

    const instance = echarts.init(el);

    const applyOption = () => {
      const ink = readTokenColor('--color-ink', '--color-ink-2');
      const muted = readTokenColor('--color-muted', '--color-ink-2');
      const rule = readTokenColor('--color-rule', '--color-muted');
      const ruleStrong = readTokenColor('--color-rule-strong', '--color-rule');
      const accent = readTokenColor('--color-accent', '--color-ink');
      const info = readTokenColor('--color-info', '--color-accent');
      const success = readTokenColor('--color-success', '--color-ink');
      const warn = readTokenColor('--color-warn', '--color-accent');
      const plate = readTokenColor('--color-plate', '--color-paper');

      const baseOption: Record<string, unknown> = {
        backgroundColor: 'transparent',
        color: [accent, info, success, warn, ink],
        textStyle: { color: ink },
        grid: { left: 56, right: 24, top: 36, bottom: 48, containLabel: true },
        ...chart.option,
        tooltip: {
          backgroundColor: plate,
          borderColor: ruleStrong,
          borderWidth: 1,
          textStyle: { color: ink },
          ...((chart.option.tooltip as Record<string, unknown>) || {}),
        },
        xAxis: chart.option.xAxis
          ? {
              axisLine: { lineStyle: { color: ruleStrong } },
              axisLabel: { color: muted },
              splitLine: { lineStyle: { color: rule, type: 'dashed' } },
              ...(chart.option.xAxis as Record<string, unknown>),
            }
          : undefined,
        yAxis: chart.option.yAxis
          ? {
              axisLine: { lineStyle: { color: ruleStrong } },
              axisLabel: { color: muted },
              splitLine: { lineStyle: { color: rule, type: 'dashed' } },
              ...(chart.option.yAxis as Record<string, unknown>),
            }
          : undefined,
      };
      instance.setOption(baseOption, true);
    };

    applyOption();

    const observer = new ResizeObserver(() => {
      instance.resize();
    });
    observer.observe(el);

    const themeObserver = new MutationObserver(() => {
      applyOption();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => {
      themeObserver.disconnect();
      observer.disconnect();
      instance.dispose();
    };
  }, [chart]);

  return (
    <div className="hp-plate" style={{ padding: 'var(--space-md)' }}>
      <h3 style={{ margin: '0 0 var(--space-sm) 0', fontSize: 'var(--text-title)', fontWeight: 600 }}>{chart.title}</h3>
      <div ref={containerRef} style={{ width: '100%', height: `${height}px` }} />
    </div>
  );
};
