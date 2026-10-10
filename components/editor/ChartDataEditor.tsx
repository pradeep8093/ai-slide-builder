"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { MAX_CHART_CATEGORIES, MAX_CHART_LABEL_LENGTH, MAX_CHART_SERIES } from "@/lib/constants";
import type { ChartElement } from "@/lib/schema";
import { useEditorStore } from "@/lib/store/editorStore";
import Modal from "../ui/Modal";

interface ChartDataEditorProps {
  slideId: string;
  chart: ChartElement;
  onClose: () => void;
}

interface DraftSeries {
  name: string;
  values: string[];
}

export function parseValue(raw: string): number | null {
  const trimmed = raw.trim().replace(/,/g, "");
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

const cellInput = "h-8 w-full rounded-md border px-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

export default function ChartDataEditor({ slideId, chart, onClose }: ChartDataEditorProps) {
  const [title, setTitle] = useState(chart.title);
  const [categories, setCategories] = useState<string[]>(chart.categories);
  const [series, setSeries] = useState<DraftSeries[]>(chart.series.map((s) => ({ name: s.name, values: s.values.map(String) })));

  const invalid = series.some((s) => s.values.some((v) => parseValue(v) === null));
  const isPie = chart.chartType === "pie";

  const save = () => {
    if (invalid) return;
    useEditorStore.getState().updateElement(slideId, chart.id, {
      title: title.trim(),
      categories: categories.map((c) => c.trim()),
      series: series.map((s, i) => ({ name: s.name.trim() || `Series ${i + 1}`, values: s.values.map((v) => parseValue(v) ?? 0) })),
    });
    onClose();
  };

  const addRow = () => {
    setCategories((c) => [...c, `Item ${c.length + 1}`]);
    setSeries((all) => all.map((s) => ({ ...s, values: [...s.values, "0"] })));
  };
  const removeRow = (row: number) => {
    setCategories((c) => c.filter((_, i) => i !== row));
    setSeries((all) => all.map((s) => ({ ...s, values: s.values.filter((_, i) => i !== row) })));
  };
  const addSeries = () => setSeries((all) => [...all, { name: `Series ${all.length + 1}`, values: categories.map(() => "0") }]);
  const removeSeries = (index: number) => setSeries((all) => all.filter((_, i) => i !== index));

  return (
    <Modal
      title="Edit chart data"
      onClose={onClose}
      width={Math.min(960, 360 + series.length * 150)}
      footer={
        <>
          {invalid && <p className="mr-auto self-center text-sm text-red-600">Every value must be a number.</p>}
          <button type="button" onClick={onClose} className="h-9 rounded-md border border-neutral-200 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={invalid} className="h-9 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40">
            Save
          </button>
        </>
      }
    >
      <label className="block text-sm font-medium text-neutral-700">
        Chart title
        <input
          type="text"
          value={title}
          maxLength={200}
          placeholder="Optional"
          onChange={(e) => setTitle(e.target.value)}
          className={`${cellInput} mt-1 border-neutral-200 font-normal`}
          data-autofocus
        />
      </label>

      {isPie && <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">Pie charts show only the first series. Negative values are shown as empty slices.</p>}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-separate border-spacing-1">
          <thead>
            <tr>
              <th className="w-40 text-left text-xs font-medium text-neutral-500">Label</th>
              {series.map((s, si) => (
                <th key={si} className="min-w-32">
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      aria-label={`Series ${si + 1} name`}
                      value={s.name}
                      maxLength={MAX_CHART_LABEL_LENGTH}
                      onChange={(e) => setSeries((all) => all.map((x, i) => (i === si ? { ...x, name: e.target.value } : x)))}
                      className={`${cellInput} border-neutral-200 font-medium`}
                    />
                    <button
                      type="button"
                      aria-label={`Remove series ${si + 1}`}
                      disabled={series.length === 1}
                      onClick={() => removeSeries(si)}
                      className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:invisible"
                    >
                      <X size={14} aria-hidden />
                    </button>
                  </div>
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {categories.map((category, row) => (
              <tr key={row}>
                <td>
                  <input
                    type="text"
                    aria-label={`Label ${row + 1}`}
                    value={category}
                    maxLength={MAX_CHART_LABEL_LENGTH}
                    onChange={(e) => setCategories((c) => c.map((x, i) => (i === row ? e.target.value : x)))}
                    className={`${cellInput} border-neutral-200`}
                  />
                </td>
                {series.map((s, si) => {
                  const bad = parseValue(s.values[row]) === null;
                  return (
                    <td key={si}>
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={`${s.name || `Series ${si + 1}`}, ${category || `row ${row + 1}`}`}
                        aria-invalid={bad}
                        value={s.values[row]}
                        onChange={(e) =>
                          setSeries((all) => all.map((x, i) => (i === si ? { ...x, values: x.values.map((v, r) => (r === row ? e.target.value : v)) } : x)))
                        }
                        className={`${cellInput} text-right tabular-nums ${bad ? "border-red-400 bg-red-50" : "border-neutral-200"}`}
                      />
                    </td>
                  );
                })}
                <td>
                  <button
                    type="button"
                    aria-label={`Remove row ${row + 1}`}
                    disabled={categories.length === 1}
                    onClick={() => removeRow(row)}
                    className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:invisible"
                  >
                    <X size={14} aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={addRow}
          disabled={categories.length >= MAX_CHART_CATEGORIES}
          title={categories.length >= MAX_CHART_CATEGORIES ? `Up to ${MAX_CHART_CATEGORIES} rows` : undefined}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-neutral-200 px-3 text-sm text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={14} aria-hidden />
          Add row
        </button>
        <button
          type="button"
          onClick={addSeries}
          disabled={series.length >= MAX_CHART_SERIES}
          title={series.length >= MAX_CHART_SERIES ? `Up to ${MAX_CHART_SERIES} series` : undefined}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-neutral-200 px-3 text-sm text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={14} aria-hidden />
          Add series
        </button>
      </div>
    </Modal>
  );
}
