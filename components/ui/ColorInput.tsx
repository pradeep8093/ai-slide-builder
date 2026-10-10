"use client";

interface ColorInputProps {
  label: string;
  value: string | null;
  onChange: (color: string) => void;
  disabled?: boolean;
}

/** A compact color swatch backed by the native color picker. `null` shows a "no color" swatch. */
export default function ColorInput({ label, value, onChange, disabled }: ColorInputProps) {
  return (
    <label
      className={`relative flex h-8 w-8 items-center justify-center rounded-md border border-neutral-200 hover:bg-neutral-100 ${
        disabled ? "pointer-events-none opacity-40" : "cursor-pointer"
      }`}
      title={label}
    >
      <span
        className="h-5 w-5 rounded border border-black/10"
        style={
          value
            ? { background: value }
            : { background: "linear-gradient(to top right, transparent calc(50% - 1px), #ef4444 50%, transparent calc(50% + 1px)), #fff" }
        }
        aria-hidden
      />
      <input
        type="color"
        aria-label={label}
        value={value ?? "#ffffff"}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </label>
  );
}
