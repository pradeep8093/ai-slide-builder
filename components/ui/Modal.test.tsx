import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Modal from "./Modal";

describe("Modal", () => {
  it("renders an accessible dialog with title, body and footer", () => {
    render(
      <Modal title="Settings" onClose={() => undefined} footer={<button>Save</button>}>
        <p>Body</p>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Body")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("focuses [data-autofocus] first, otherwise the first focusable element", () => {
    const { unmount } = render(
      <Modal title="A" onClose={() => undefined}>
        <input aria-label="first" />
        <input aria-label="second" data-autofocus />
      </Modal>,
    );
    expect(screen.getByLabelText("second")).toHaveFocus();
    unmount();
    render(<Modal title="B" onClose={() => undefined}>text</Modal>);
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("closes on Escape, the close button and backdrop clicks but not panel clicks", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Modal title="A" onClose={onClose}>content</Modal>);
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByText("content"));
    expect(onClose).toHaveBeenCalledTimes(2);
    await user.click(document.querySelector("[data-modal-backdrop]") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("traps focus with Tab and Shift+Tab", async () => {
    const user = userEvent.setup();
    render(
      <Modal title="A" onClose={() => undefined} footer={<button>Last</button>}>
        <input aria-label="field" />
      </Modal>,
    );
    const close = screen.getByRole("button", { name: "Close" });
    const last = screen.getByRole("button", { name: "Last" });
    last.focus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(last).toHaveFocus();
  });

  it("restores focus when closed", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<Modal title="A" onClose={() => undefined}>x</Modal>);
    expect(opener).not.toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
