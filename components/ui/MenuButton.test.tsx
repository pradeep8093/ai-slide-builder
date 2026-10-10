import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MenuButton from "./MenuButton";

function setup(extra: Partial<React.ComponentProps<typeof MenuButton>> = {}) {
  const one = vi.fn();
  const two = vi.fn();
  render(
    <>
      <MenuButton
        label="Insert"
        items={[
          { id: "1", label: "First", onSelect: one },
          { id: "x", label: "Disabled", onSelect: vi.fn(), disabled: true },
          { id: "2", label: "Second", onSelect: two, danger: true },
        ]}
        {...extra}
      >
        Insert ▾
      </MenuButton>
      <button>Outside</button>
    </>,
  );
  return { one, two };
}

describe("MenuButton", () => {
  it("opens a menu and runs the chosen item", async () => {
    const user = userEvent.setup();
    const { one } = setup();
    const button = screen.getByRole("button", { name: "Insert" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: "First" })).toHaveFocus();
    await user.click(screen.getByRole("menuitem", { name: "First" }));
    expect(one).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("supports keyboard navigation and skips disabled items", async () => {
    const user = userEvent.setup();
    const { two } = setup();
    screen.getByRole("button", { name: "Insert" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "First" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Second" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "First" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Second" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("menuitem", { name: "First" })).toHaveFocus();
    await user.keyboard("{End}{Enter}");
    expect(two).toHaveBeenCalled();
  });

  it("closes on Escape, Tab and outside clicks", async () => {
    const user = userEvent.setup();
    setup();
    const button = screen.getByRole("button", { name: "Insert" });
    await user.click(button);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    await user.click(button);
    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(button);
    await user.tab();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(button);
    await user.click(button);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("can be disabled", async () => {
    const user = userEvent.setup();
    setup({ disabled: true, title: "Add a slide first" });
    const button = screen.getByRole("button", { name: "Insert" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Add a slide first");
    await user.click(button);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes when the window resizes", async () => {
    const user = userEvent.setup();
    setup({ align: "end" });
    await user.click(screen.getByRole("button", { name: "Insert" }));
    window.dispatchEvent(new Event("resize"));
    await vi.waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });
});
