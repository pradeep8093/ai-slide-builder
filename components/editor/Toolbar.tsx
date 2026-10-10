"use client";

import { useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  BarChart3,
  Bold,
  BringToFront,
  ChevronDown,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Crop,
  Group,
  ImageIcon,
  Italic,
  Layers,
  Lock,
  Minus,
  MoreHorizontal,
  Plus,
  Scissors,
  SendToBack,
  Shapes,
  Sheet,
  Table2,
  Trash2,
  Type,
  Underline,
  Ungroup,
  Unlock,
} from "lucide-react";
import {
  CHART_KINDS,
  CHART_LABELS,
  FONT_FAMILIES,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  MAX_ALT_LENGTH,
  SHAPE_KINDS,
  SHAPE_LABELS,
  type ChartKind,
  type FontFamily,
  type TextAlign,
} from "@/lib/constants";
import { createChartElement, createImageElement, createShapeElement, createTableElement, createTextElement } from "@/lib/factory";
import { clamp } from "@/lib/geometry";
import { importImageFile } from "@/lib/image";
import { isRadial, legendVisible } from "@/lib/chart";
import { DEFAULT_LINE_COLOR } from "@/lib/sanitize";
import type { ChartElement, ElementPatch, ImageElement, ShapeElement, SlideElement, TableElement, TextElement } from "@/lib/schema";
import { selectCurrentElement, selectCurrentSlide, selectSelectedElements, useEditorStore } from "@/lib/store/editorStore";
import { toast } from "@/lib/store/toastStore";
import { useShallow } from "zustand/react/shallow";
import { copySelection, cutSelection, pasteFromApp, writeSystemText } from "../hooks/useClipboard";
import ColorInput from "../ui/ColorInput";
import MenuButton from "../ui/MenuButton";

const toolButton =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";
const iconButton =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 aria-pressed:bg-indigo-50 aria-pressed:text-indigo-700";
const selectClass = "h-8 shrink-0 rounded-md border border-neutral-200 bg-white px-2 text-sm text-neutral-800 hover:border-neutral-300 focus:border-indigo-500 focus:outline-none";

function Divider() {
  return <div className="mx-1.5 h-6 w-px shrink-0 bg-neutral-200" aria-hidden />;
}

/** Text field that edits a draft locally and commits on blur / Enter (so typing isn't one undo step per key). */
function DraftInput({
  value,
  onCommit,
  ...props
}: { value: string; onCommit: (value: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  // Enter/Escape already handled the draft; the blur that follows must not commit it again.
  const skipBlurCommit = useRef(false);
  // Pick up outside changes (undo, another element selected) without an effect.
  if (value !== synced) {
    setSynced(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft === value) return;
    onCommit(draft);
    // Show the stored value again: if the commit was rejected or clamped, the field must not keep the raw input.
    setDraft(value);
  };
  return (
    <input
      {...props}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (skipBlurCommit.current) skipBlurCommit.current = false;
        else commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit();
          skipBlurCommit.current = true;
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          setDraft(value);
          skipBlurCommit.current = true;
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function FontSizeControl({ element, update }: { element: { fontSize: number }; update: (patch: ElementPatch, key?: string) => void }) {
  const set = (size: number) => update({ fontSize: clamp(Math.round(size), FONT_SIZE_MIN, FONT_SIZE_MAX) }, "fontSize");
  return (
    <div className="flex shrink-0 items-center rounded-md border border-neutral-200">
      <button type="button" className="flex h-8 w-7 items-center justify-center text-neutral-600 hover:bg-neutral-100 disabled:opacity-40" aria-label="Decrease font size" disabled={element.fontSize <= FONT_SIZE_MIN} onClick={() => set(element.fontSize - 2)}>
        <Minus size={14} aria-hidden />
      </button>
      <DraftInput
        aria-label="Font size"
        inputMode="numeric"
        value={String(element.fontSize)}
        onCommit={(raw) => {
          const n = Number(raw);
          if (raw.trim() && Number.isFinite(n)) set(n);
          else toast.error(`Font size must be a number between ${FONT_SIZE_MIN} and ${FONT_SIZE_MAX}.`);
        }}
        className="h-8 w-11 border-x border-neutral-200 text-center text-sm tabular-nums focus:outline-none"
      />
      <button type="button" className="flex h-8 w-7 items-center justify-center text-neutral-600 hover:bg-neutral-100 disabled:opacity-40" aria-label="Increase font size" disabled={element.fontSize >= FONT_SIZE_MAX} onClick={() => set(element.fontSize + 2)}>
        <Plus size={14} aria-hidden />
      </button>
    </div>
  );
}

function FontSelect({ value, update }: { value: FontFamily; update: (patch: ElementPatch) => void }) {
  return (
    <select aria-label="Font" className={`${selectClass} w-36`} value={value} onChange={(e) => update({ fontFamily: e.target.value as FontFamily })}>
      {FONT_FAMILIES.map((font) => (
        <option key={font} value={font} style={{ fontFamily: font }}>
          {font}
        </option>
      ))}
    </select>
  );
}

function TextControls({ element, update }: { element: TextElement; update: (patch: ElementPatch, key?: string) => void }) {
  const aligns: { value: TextAlign; label: string; Icon: typeof AlignLeft }[] = [
    { value: "left", label: "Align left", Icon: AlignLeft },
    { value: "center", label: "Align center", Icon: AlignCenter },
    { value: "right", label: "Align right", Icon: AlignRight },
  ];
  return (
    <>
      <FontSelect value={element.fontFamily} update={update} />
      <FontSizeControl element={element} update={update} />
      <button type="button" className={iconButton} aria-label="Bold" aria-pressed={element.bold} onClick={() => update({ bold: !element.bold })}>
        <Bold size={16} aria-hidden />
      </button>
      <button type="button" className={iconButton} aria-label="Italic" aria-pressed={element.italic} onClick={() => update({ italic: !element.italic })}>
        <Italic size={16} aria-hidden />
      </button>
      <button type="button" className={iconButton} aria-label="Underline" aria-pressed={element.underline} onClick={() => update({ underline: !element.underline })}>
        <Underline size={16} aria-hidden />
      </button>
      <Divider />
      {aligns.map(({ value, label, Icon }) => (
        <button key={value} type="button" className={iconButton} aria-label={label} aria-pressed={element.align === value} onClick={() => update({ align: value })}>
          <Icon size={16} aria-hidden />
        </button>
      ))}
      <Divider />
      <ColorInput label="Text color" value={element.color} onChange={(color) => update({ color }, "color")} />
    </>
  );
}

const BORDER_WIDTHS = [0, 1, 2, 4, 8, 12];

function ShapeControls({ element, update }: { element: ShapeElement; update: (patch: ElementPatch, key?: string) => void }) {
  if (element.shape === "line") {
    return (
      <>
        <ColorInput label="Line color" value={element.stroke ?? DEFAULT_LINE_COLOR} onChange={(stroke) => update({ stroke }, "stroke")} />
        <select aria-label="Line width" className={selectClass} value={element.strokeWidth} onChange={(e) => update({ strokeWidth: Number(e.target.value) })}>
          {BORDER_WIDTHS.filter((w) => w > 0).map((w) => (
            <option key={w} value={w}>
              {w} px
            </option>
          ))}
        </select>
      </>
    );
  }
  const borderWidth = element.stroke === null ? 0 : element.strokeWidth;
  const widths = BORDER_WIDTHS.includes(borderWidth) ? BORDER_WIDTHS : [...BORDER_WIDTHS, borderWidth].sort((a, b) => a - b);
  return (
    <>
      <ColorInput label="Fill color" value={element.fill} onChange={(fill) => update({ fill }, "fill")} />
      <button
        type="button"
        className={`${toolButton} px-2`}
        aria-pressed={element.fill === null}
        onClick={() => update({ fill: element.fill === null ? "#4f6bed" : null })}
        title={element.fill === null ? "Add a fill" : "Remove the fill"}
      >
        No fill
      </button>
      <Divider />
      <ColorInput
        label="Border color"
        value={element.stroke}
        onChange={(stroke) => update(borderWidth === 0 ? { stroke, strokeWidth: 2 } : { stroke }, "stroke")}
      />
      <select
        aria-label="Border width"
        className={selectClass}
        value={borderWidth}
        onChange={(e) => {
          const width = Number(e.target.value);
          update(width === 0 ? { stroke: null, strokeWidth: 0 } : { stroke: element.stroke ?? DEFAULT_LINE_COLOR, strokeWidth: width });
        }}
      >
        {widths.map((w) => (
          <option key={w} value={w}>
            {w === 0 ? "No border" : `${w} px`}
          </option>
        ))}
      </select>
    </>
  );
}

function ImageControls({ element, update, onCrop }: { element: ImageElement; update: (patch: ElementPatch, key?: string) => void; onCrop: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const lockedTitle = element.locked ? "Unlock the image first" : undefined;
  return (
    <>
      <button type="button" className={toolButton} disabled={element.locked} title={lockedTitle} onClick={() => inputRef.current?.click()}>
        <ImageIcon size={16} aria-hidden />
        Replace
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        data-testid="replace-image-input"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          try {
            const image = await importImageFile(file);
            // Keep the current width; the height follows the new image's aspect ratio. Any crop is dropped.
            update({ src: image.src, crop: null, width: element.width, height: (element.width * image.height) / image.width });
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "The image couldn't be added.");
          }
        }}
      />
      <button type="button" className={toolButton} disabled={element.locked} title={lockedTitle ?? "Crop the image"} onClick={onCrop}>
        <Crop size={16} aria-hidden />
        Crop
      </button>
      <DraftInput
        aria-label="Alt text"
        placeholder="Alt text (describes the image)"
        value={element.alt}
        maxLength={MAX_ALT_LENGTH}
        onCommit={(alt) => update({ alt: alt.trim() })}
        className="h-8 w-56 shrink-0 rounded-md border border-neutral-200 px-2 text-sm placeholder:text-neutral-400 focus:border-indigo-500 focus:outline-none"
      />
    </>
  );
}

const toggleButton = `${toolButton} aria-pressed:bg-indigo-50 aria-pressed:text-indigo-700`;

function ChartControls({ element, update, onEditData }: { element: ChartElement; update: (patch: ElementPatch, key?: string) => void; onEditData: () => void }) {
  const radial = isRadial(element.chartType);
  const multi = element.series.length > 1;
  const legendUseful = radial || multi;
  const stackable = element.chartType === "bar";
  const dualCapable = element.chartType === "bar" || element.chartType === "line";
  return (
    <>
      <select aria-label="Chart type" className={selectClass} value={element.chartType} onChange={(e) => update({ chartType: e.target.value as ChartKind })}>
        {CHART_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {CHART_LABELS[kind]}
          </option>
        ))}
      </select>
      <button type="button" className={toolButton} onClick={onEditData}>
        <Table2 size={16} aria-hidden />
        Edit data
      </button>
      <Divider />
      <button
        type="button"
        className={toggleButton}
        aria-pressed={legendVisible(element)}
        disabled={!legendUseful}
        title={legendUseful ? "Show or hide the legend" : "A legend appears when the chart has two or more series"}
        onClick={() => update({ showLegend: !element.showLegend })}
      >
        Legend
      </button>
      <button type="button" className={toggleButton} aria-pressed={Boolean(element.showValues)} title="Show each value on the chart" onClick={() => update({ showValues: !element.showValues })}>
        Data labels
      </button>
      {stackable && (
        <button
          type="button"
          className={toggleButton}
          aria-pressed={Boolean(element.stacked) && multi}
          disabled={!multi}
          title={multi ? "Stack the series on top of each other" : "Stacking needs two or more series"}
          onClick={() => update({ stacked: !element.stacked })}
        >
          Stacked
        </button>
      )}
      {dualCapable && (
        <button
          type="button"
          className={toggleButton}
          aria-pressed={Boolean(element.dualAxis) && multi}
          disabled={!multi}
          title={multi ? "Plot the last series as a line against a second axis on the right" : "A second axis needs two or more series"}
          onClick={() => update({ dualAxis: !element.dualAxis })}
        >
          Dual axis
        </button>
      )}
    </>
  );
}

function TableControls({ element, update, onEdit }: { element: TableElement; update: (patch: ElementPatch, key?: string) => void; onEdit: () => void }) {
  return (
    <>
      <button type="button" className={toolButton} onClick={onEdit}>
        <Table2 size={16} aria-hidden />
        Edit table
      </button>
      <button type="button" className={toggleButton} aria-pressed={element.headerRow} title="Style the first row as a header" onClick={() => update({ headerRow: !element.headerRow })}>
        Header row
      </button>
      <Divider />
      <FontSelect value={element.fontFamily} update={update} />
      <FontSizeControl element={element} update={update} />
      <ColorInput label="Text color" value={element.color} onChange={(color) => update({ color }, "color")} />
      <Divider />
      <ColorInput label="Header fill" value={element.headerFill} disabled={!element.headerRow} onChange={(headerFill) => update({ headerFill }, "headerFill")} />
      <ColorInput label="Border color" value={element.borderColor} onChange={(borderColor) => update({ borderColor }, "borderColor")} />
      <button
        type="button"
        className={toggleButton}
        aria-pressed={element.borderColor === null}
        onClick={() => update({ borderColor: element.borderColor === null ? "#d1d5db" : null })}
        title={element.borderColor === null ? "Add borders" : "Remove borders"}
      >
        No borders
      </button>
    </>
  );
}

interface ToolbarProps {
  /** Opens the dedicated editor for an element (chart data, table cells, image crop). */
  onEditElement: (elementId: string) => void;
}

export default function Toolbar({ onEditElement }: ToolbarProps) {
  const slide = useEditorStore(selectCurrentSlide);
  const element = useEditorStore(selectCurrentElement);
  const selected = useEditorStore(useShallow(selectSelectedElements));
  const imageInputRef = useRef<HTMLInputElement>(null);
  const { addElement, setEditing, updateElement, setSlideBackground, duplicateElements, deleteElements, reorderElements, groupElements, ungroupElements, setElementsLocked } =
    useEditorStore.getState();
  const disabledTitle = slide ? undefined : "Add a slide first";
  // With elements selected the formatting controls need the room, so insert tools show icons only.
  const labelClass = selected.length > 0 ? "sr-only" : undefined;
  const ids = selected.map((e) => e.id);
  const allLocked = selected.length > 0 && selected.every((e) => e.locked);
  const groupIds = new Set(selected.map((e) => e.groupId ?? `solo:${e.id}`));
  const canGroup = selected.length > 1 && groupIds.size > 1;
  const canUngroup = selected.some((e) => e.groupId);

  const insert = (newElement: SlideElement) => {
    if (!slide) return;
    const added = addElement(slide.id, newElement);
    if (added && newElement.type === "text") setEditing(newElement.id, true);
  };

  const update = (patch: ElementPatch, key?: string) => {
    if (!slide || !element) return;
    updateElement(slide.id, element.id, patch, key ? { coalesceKey: `${key}:${element.id}` } : undefined);
  };

  const copy = (cut: boolean) => {
    const entry = cut ? cutSelection() : copySelection();
    if (entry) writeSystemText(entry.plainText);
  };

  return (
    <div role="toolbar" aria-label="Slide tools" className="flex min-h-12 shrink-0 flex-wrap items-center gap-1 border-b border-neutral-200 bg-white px-3 py-2">
      <button type="button" className={toolButton} disabled={!slide} title={disabledTitle ?? "Insert text box"} onClick={() => insert(createTextElement())}>
        <Type size={16} aria-hidden />
        <span className={labelClass}>Text</span>
      </button>
      <button type="button" className={toolButton} disabled={!slide} title={disabledTitle ?? "Insert image"} onClick={() => imageInputRef.current?.click()}>
        <ImageIcon size={16} aria-hidden />
        <span className={labelClass}>Image</span>
      </button>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        data-testid="insert-image-input"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          try {
            const image = await importImageFile(file);
            insert(createImageElement(image.src, image.width, image.height, file.name.replace(/\.[^.]+$/, "")));
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "The image couldn't be added.");
          }
        }}
      />
      <button type="button" className={toolButton} disabled={!slide} title={disabledTitle ?? "Insert table"} onClick={() => insert(createTableElement())}>
        <Sheet size={16} aria-hidden />
        <span className={labelClass}>Table</span>
      </button>
      <MenuButton
        label="Insert chart"
        title={disabledTitle ?? "Insert chart"}
        disabled={!slide}
        className={toolButton}
        items={CHART_KINDS.map((kind) => ({ id: kind, label: CHART_LABELS[kind], onSelect: () => insert(createChartElement(kind)) }))}
      >
        <BarChart3 size={16} aria-hidden />
        <span className={labelClass}>Chart</span>
        <ChevronDown size={14} aria-hidden />
      </MenuButton>
      <MenuButton
        label="Insert shape"
        title={disabledTitle ?? "Insert shape"}
        disabled={!slide}
        className={toolButton}
        items={SHAPE_KINDS.map((kind) => ({ id: kind, label: SHAPE_LABELS[kind], onSelect: () => insert(createShapeElement(kind)) }))}
      >
        <Shapes size={16} aria-hidden />
        <span className={labelClass}>Shape</span>
        <ChevronDown size={14} aria-hidden />
      </MenuButton>

      {slide && <Divider />}

      {slide && selected.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-neutral-600">
          <span>Background</span>
          <ColorInput label="Slide background" value={slide.background} onChange={(color) => setSlideBackground(slide.id, color)} />
        </div>
      )}

      {slide && element && (
        <div className="flex flex-wrap items-center gap-1" data-testid={`format-${element.type}`}>
          {element.type === "text" && <TextControls element={element} update={update} />}
          {element.type === "shape" && <ShapeControls element={element} update={update} />}
          {element.type === "image" && <ImageControls element={element} update={update} onCrop={() => onEditElement(element.id)} />}
          {element.type === "chart" && <ChartControls element={element} update={update} onEditData={() => onEditElement(element.id)} />}
          {element.type === "table" && <TableControls element={element} update={update} onEdit={() => onEditElement(element.id)} />}
        </div>
      )}

      {slide && selected.length > 1 && (
        <span className="px-1 text-sm text-neutral-600" data-testid="multi-selection">
          {selected.length} elements selected
        </span>
      )}

      {slide && selected.length > 0 && (
        <div className="ml-auto flex items-center gap-1 pl-2">
          <button
            type="button"
            className={iconButton}
            aria-pressed={allLocked}
            aria-label={allLocked ? "Unlock" : "Lock"}
            title={allLocked ? "Unlock: allow moving, resizing and AI edits again" : "Lock: prevent moving, resizing, deleting and AI edits"}
            onClick={() => setElementsLocked(slide.id, ids, !allLocked)}
          >
            {allLocked ? <Lock size={16} aria-hidden /> : <Unlock size={16} aria-hidden />}
          </button>
          {canGroup && (
            <button type="button" className={iconButton} aria-label="Group" title="Group" onClick={() => groupElements(slide.id, ids)}>
              <Group size={16} aria-hidden />
            </button>
          )}
          {canUngroup && (
            <button type="button" className={iconButton} aria-label="Ungroup" title="Ungroup" onClick={() => ungroupElements(slide.id, ids)}>
              <Ungroup size={16} aria-hidden />
            </button>
          )}
          <MenuButton
            label="Arrange"
            align="end"
            className={iconButton}
            items={[
              { id: "front", label: "Bring to front", icon: <ArrowUpToLine size={14} />, onSelect: () => reorderElements(slide.id, ids, "front") },
              { id: "forward", label: "Bring forward", icon: <BringToFront size={14} />, onSelect: () => reorderElements(slide.id, ids, "forward") },
              { id: "backward", label: "Send backward", icon: <SendToBack size={14} />, onSelect: () => reorderElements(slide.id, ids, "backward") },
              { id: "back", label: "Send to back", icon: <ArrowDownToLine size={14} />, onSelect: () => reorderElements(slide.id, ids, "back") },
            ]}
          >
            <Layers size={16} aria-hidden />
          </MenuButton>
          <button type="button" className={iconButton} aria-label="Duplicate" title="Duplicate" onClick={() => duplicateElements(slide.id, ids)}>
            <CopyPlus size={16} aria-hidden />
          </button>
          <button
            type="button"
            className={`${iconButton} hover:text-red-600`}
            aria-label="Delete"
            title={allLocked ? "Locked elements can't be deleted" : "Delete"}
            disabled={allLocked}
            onClick={() => deleteElements(slide.id, ids)}
          >
            <Trash2 size={16} aria-hidden />
          </button>
          <MenuButton
            label="More actions"
            align="end"
            className={iconButton}
            items={[
              { id: "copy", label: "Copy", icon: <Copy size={14} />, onSelect: () => copy(false) },
              { id: "cut", label: "Cut", icon: <Scissors size={14} />, onSelect: () => copy(true) },
              { id: "paste", label: "Paste", icon: <ClipboardPaste size={14} />, onSelect: () => pasteFromApp() },
            ]}
          >
            <MoreHorizontal size={16} aria-hidden />
          </MenuButton>
        </div>
      )}

      {slide && selected.length === 0 && (
        <div className="ml-auto flex items-center pl-2">
          <button type="button" className={toolButton} title="Paste copied elements or slides" onClick={() => pasteFromApp()}>
            <ClipboardPaste size={16} aria-hidden />
            Paste
          </button>
        </div>
      )}
    </div>
  );
}
