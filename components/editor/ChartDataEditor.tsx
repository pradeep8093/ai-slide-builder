"use client";

import { useState } from "react";
import { ClipboardPaste, Plus, X } from "lucide-react";
import { chartDataFromGrid, invalidScatterRows, isRadial } from "@/lib/chart";
import { MAX_CHART_CATEGORIES, MAX_CHART_LABEL_LENGTH, MAX_CHART_SERIES } from "@/lib/constants";
import type { ChartElement } from "@/lib/schema";
import { useEditorStore } from "@/lib/store/editorStore";
import { parseDelimited, parseNumber } from "@/lib/tabular";
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

/** A cell value as a number ("1,200", "$45" and "12%" are accepted). Null when it isn't one. */
export const parseValue = parseNumber;

const cellInput = "h-8 w-full rounded-md border px-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

export default function ChartDataEditor({ slideId, chart, onClose }: ChartDataEditorProps) {
  const [title, setTitle] = useState(chart.title);
  const [categories, setCategories] = useState<string[]>(chart.categories);
  const [series, setSeries] = useState<DraftSeries[]>(chart.series.map((s) => ({ name: s.name, values: s.values.map(String) })));

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteMessage, setPasteMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  const scatter = chart.chartType === "scatter";
  const badValues = series.some((s) => s.values.some((v) => parseValue(v) === null));
  const badX = scatter ? invalidScatterRows(categories) : [];
  const invalid = badValues || badX.length > 0;
  const radial = isRadial(chart.chartType);

  const applyPaste = () => {
    const data = chartDataFromGrid(parseDelimited(pasteText));
    if (!data) {
      setPasteMessage({ kind: "error", text: "No data found. Put labels in the first column and numbers in the columns next to it." });
      return;
    }
    setCategories(data.categories);
    setSeries(data.series);
    setPasteOpen(false);
    setPasteText("");
    setPasteMessage(
      data.truncated ? { kind: "info", text: `Only the first ${MAX_CHART_CATEGORIES} rows and ${MAX_CHART_SERIES} series were used.` } : null,
    );
  };

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
    setCategories((c) => [...c, scatter ? String(c.length + 1) : `Item ${c.length + 1}`]);
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
          {invalid && (
            <p className="mr-auto self-center text-sm text-red-600">{badValues ? "Every value must be a number." : "Every X value must be a number."}</p>
          )}
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

      {radial && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {chart.chartType === "pie" ? "Pie" : "Doughnut"} charts show only the first series. Negative values are shown as empty slices.
        </p>
      )}
      {scatter && (
        <p className="mt-3 rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-600">Each row is a point: the first column is its X value, each series column its Y value.</p>
      )}

      <div className="mt-4">
        {pasteOpen ? (
          <div className="rounded-lg border border-neutral-200 p-3">
            <label className="block text-sm font-medium text-neutral-700">
              Paste cells from a spreadsheet, or CSV text
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={5}
                placeholder={"Quarter\tRevenue\nQ1\t120\nQ2\t180"}
                className="mt-1 w-full rounded-md border border-neutral-200 px-2 py-1.5 font-mono text-xs font-normal focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                autoFocus
              />
            </label>
            <p className="mt-1 text-xs text-neutral-500">The first column becomes the labels, the other columns the series. A first row of names becomes the series names. This replaces the current data.</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={applyPaste}
                disabled={!pasteText.trim()}
                className="h-8 rounded-md bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
              >
                Use this data
              </button>
              <button
                type="button"
                onClick={() => {
                  setPasteOpen(false);
                  setPasteMessage(null);
                }}
                className="h-8 rounded-md border border-neutral-200 px-3 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPasteOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 px-3 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            <ClipboardPaste size={14} aria-hidden />
            Paste data
          </button>
        )}
        {pasteMessage && (
          <p role={pasteMessage.kind === "error" ? "alert" : "status"} className={`mt-2 text-sm ${pasteMessage.kind === "error" ? "text-red-600" : "text-neutral-600"}`}>
            {pasteMessage.text}
          </p>
        )}
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-separate border-spacing-1">
          <thead>
            <tr>
              <th className="w-40 text-left text-xs font-medium text-neutral-500">{scatter ? "X value" : "Label"}</th>
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
                    inputMode={scatter ? "decimal" : undefined}
                    aria-label={scatter ? `X value ${row + 1}` : `Label ${row + 1}`}
                    aria-invalid={badX.includes(row + 1)}
                    value={category}
                    maxLength={MAX_CHART_LABEL_LENGTH}
                    onChange={(e) => setCategories((c) => c.map((x, i) => (i === row ? e.target.value : x)))}
                    className={`${cellInput} ${badX.includes(row + 1) ? "border-red-400 bg-red-50" : "border-neutral-200"}`}
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
