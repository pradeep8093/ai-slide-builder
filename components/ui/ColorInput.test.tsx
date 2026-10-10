import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ColorInput from "./ColorInput";

describe("ColorInput", () => {
  it("shows the color and reports changes", () => {
    const onChange = vi.fn();
    render(<ColorInput label="Fill color" value="#ff0000" onChange={onChange} />);
    const input = screen.getByLabelText("Fill color") as HTMLInputElement;
    expect(input.value).toBe("#ff0000");
    fireEvent.change(input, { target: { value: "#00ff00" } });
    expect(onChange).toHaveBeenCalledWith("#00ff00");
  });

  it("represents 'no color' and can be disabled", () => {
    render(<ColorInput label="Border color" value={null} onChange={() => undefined} disabled />);
    const input = screen.getByLabelText("Border color") as HTMLInputElement;
    expect(input.value).toBe("#ffffff");
    expect(input).toBeDisabled();
  });
});
