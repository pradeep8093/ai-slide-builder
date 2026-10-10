import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { currentDeck, editor, seedDeck, slideWith } from "@/test/utils";
import { SLIDE_HEIGHT, SLIDE_WIDTH } from "@/lib/constants";
import { createImageElement } from "@/lib/factory";
import type { ImageCrop, ImageElement } from "@/lib/schema";
import CropEditor, { croppedGeometry, MIN_CROP, moveCrop, resizeCrop } from "./CropEditor";

const SRC = "data:image/png;base64,AAAA";
const FULL: ImageCrop = { x: 0, y: 0, width: 1, height: 1 };
/** Size the crop frame reports in these tests: 1px of pointer movement = 0.25% of the width / 0.5% of the height. */
const FRAME = { width: 400, height: 200 };

function expectCrop(actual: ImageCrop | undefined, expected: ImageCrop) {
  expect(actual).toBeDefined();
  for (const key of ["x", "y", "width", "height"] as const) expect(actual![key]).toBeCloseTo(expected[key], 6);
}

/** A 400×200 picture at (100, 100), optionally cropped. */
function image(overrides: Partial<ImageElement> = {}): ImageElement {
  return { ...createImageElement(SRC, 400, 200, "A chart"), x: 100, y: 100, width: 400, height: 200, ...overrides };
}

function setup(img: ImageElement = image()) {
  const deck = seedDeck([slideWith(img)]);
  const onClose = vi.fn();
  render(<CropEditor slideId={deck.slides[0].id} image={img} onClose={onClose} />);
  const frame = screen.getByTestId("crop-frame");
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: 0, y: 0, ...FRAME }));
  return { onClose, img };
}

const saved = () => currentDeck().slides[0].elements[0] as ImageElement;
const box = () => screen.getByRole("group", { name: "Crop area" });
const handle = (name: "nw" | "ne" | "se" | "sw") => box().querySelector<HTMLElement>(`[data-crop-handle="${name}"]`)!;

/** The crop currently shown, read from the box (rounded to 3 decimals). */
function shownCrop(): ImageCrop {
  const [x, y, width, height] = box().getAttribute("data-crop")!.split(",").map(Number);
  return { x, y, width, height };
}

function drag(target: Element, by: [number, number], options: { button?: number; from?: [number, number] } = {}) {
  const [fx, fy] = options.from ?? [50, 50];
  fireEvent.pointerDown(target, { button: options.button ?? 0, clientX: fx, clientY: fy });
  fireEvent.pointerMove(window, { clientX: fx + by[0], clientY: fy + by[1] });
  fireEvent.pointerUp(window, { clientX: fx + by[0], clientY: fy + by[1] });
}

describe("moveCrop", () => {
  it("moves the box without changing its size", () => {
    expectCrop(moveCrop({ x: 0.1, y: 0.1, width: 0.5, height: 0.4 }, 0.2, 0.15), { x: 0.3, y: 0.25, width: 0.5, height: 0.4 });
  });

  it("keeps the box inside the image", () => {
    const start = { x: 0.1, y: 0.1, width: 0.5, height: 0.4 };
    expectCrop(moveCrop(start, 1, 1), { x: 0.5, y: 0.6, width: 0.5, height: 0.4 });
    expectCrop(moveCrop(start, -1, -1), { x: 0, y: 0, width: 0.5, height: 0.4 });
  });

  it("can't move a full crop", () => {
    expectCrop(moveCrop(FULL, 0.2, -0.2), FULL);
  });
});

describe("resizeCrop", () => {
  const start: ImageCrop = { x: 0.2, y: 0.2, width: 0.5, height: 0.5 };

  it("drags the south-east corner and keeps the north-west corner", () => {
    expectCrop(resizeCrop(start, "se", 0.1, -0.1), { x: 0.2, y: 0.2, width: 0.6, height: 0.4 });
  });

  it("drags the north-west corner and keeps the south-east corner", () => {
    expectCrop(resizeCrop(start, "nw", -0.1, 0.1), { x: 0.1, y: 0.3, width: 0.6, height: 0.4 });
  });

  it("drags the north-east corner and keeps the south-west corner", () => {
    const next = resizeCrop(start, "ne", 0.1, -0.1);
    expectCrop(next, { x: 0.2, y: 0.1, width: 0.6, height: 0.6 });
    expect(next.x).toBeCloseTo(start.x);
    expect(next.y + next.height).toBeCloseTo(start.y + start.height);
  });

  it("drags the south-west corner and keeps the north-east corner", () => {
    const next = resizeCrop(start, "sw", -0.1, 0.1);
    expectCrop(next, { x: 0.1, y: 0.2, width: 0.6, height: 0.6 });
    expect(next.x + next.width).toBeCloseTo(start.x + start.width);
    expect(next.y).toBeCloseTo(start.y);
  });

  it("stops at the image edges", () => {
    expectCrop(resizeCrop(start, "se", 5, 5), { x: 0.2, y: 0.2, width: 0.8, height: 0.8 });
    expectCrop(resizeCrop(start, "nw", -5, -5), { x: 0, y: 0, width: 0.7, height: 0.7 });
    expectCrop(resizeCrop(start, "ne", 5, -5), { x: 0.2, y: 0, width: 0.8, height: 0.7 });
    expectCrop(resizeCrop(start, "sw", -5, 5), { x: 0, y: 0.2, width: 0.7, height: 0.8 });
  });

  it("never gets smaller than MIN_CROP, keeping the opposite corner", () => {
    expectCrop(resizeCrop(start, "se", -5, -5), { x: 0.2, y: 0.2, width: MIN_CROP, height: MIN_CROP });
    expectCrop(resizeCrop(start, "nw", 5, 5), { x: 0.7 - MIN_CROP, y: 0.7 - MIN_CROP, width: MIN_CROP, height: MIN_CROP });
  });

  it("keeps a crop that is already smaller than MIN_CROP inside the image", () => {
    const next = resizeCrop({ x: 0, y: 0, width: 0.02, height: 0.5 }, "nw", 0, 0);
    expect(next.x).toBeGreaterThanOrEqual(0);
    expect(next.x + next.width).toBeLessThanOrEqual(1);
  });
});

describe("croppedGeometry", () => {
  const rect = { x: 100, y: 100, width: 400, height: 200 };

  it("leaves the element alone when the crop doesn't change", () => {
    expect(croppedGeometry(rect, FULL, FULL)).toEqual(rect);
  });

  it("shrinks from the right and bottom edges without moving", () => {
    expect(croppedGeometry(rect, FULL, { x: 0, y: 0, width: 0.75, height: 0.5 })).toEqual({ x: 100, y: 100, width: 300, height: 100 });
  });

  it("keeps the picture's scale and position when cropping the left and top edges", () => {
    const next = croppedGeometry(rect, FULL, { x: 0.25, y: 0.5, width: 0.75, height: 0.5 });
    expect(next).toEqual({ x: 200, y: 200, width: 300, height: 100 });
    // Same scale: the visible part is drawn exactly where it was.
    expect(next.width / 0.75).toBeCloseTo(rect.width);
    expect(next.height / 0.5).toBeCloseTo(rect.height);
  });

  it("grows back when un-cropping", () => {
    const cropped = { x: 200, y: 150, width: 200, height: 100 };
    expect(croppedGeometry(cropped, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, FULL)).toEqual({ x: 100, y: 100, width: 400, height: 200 });
  });

  it("moves with the crop box when it is moved over the picture", () => {
    const cropped = { x: 200, y: 150, width: 200, height: 100 };
    expect(croppedGeometry(cropped, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, { x: 0.5, y: 0, width: 0.5, height: 0.5 })).toEqual({
      x: 300,
      y: 100,
      width: 200,
      height: 100,
    });
  });

  it("scales down to fit on the slide when un-cropping would make it too big", () => {
    const cropped = { x: 0, y: 0, width: 1000, height: 500 };
    const next = croppedGeometry(cropped, { x: 0, y: 0, width: 0.5, height: 0.5 }, FULL);
    expect(next.width).toBeCloseTo(SLIDE_WIDTH);
    expect(next.height).toBeCloseTo(640);
    expect(next.width).toBeLessThanOrEqual(SLIDE_WIDTH);
    expect(next.height).toBeLessThanOrEqual(SLIDE_HEIGHT);
    // The aspect ratio of the full picture is kept.
    expect(next.width / next.height).toBeCloseTo(2);
  });
});

describe("CropEditor", () => {
  it("shows the image with the full crop box when it isn't cropped yet", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Crop image" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "A chart" })).toHaveAttribute("src", SRC);
    expect(box()).toHaveAttribute("data-crop", "0.000,0.000,1.000,1.000");
    expect(box()).toHaveStyle({ left: "0%", top: "0%", width: "100%", height: "100%" });
    expect(box().querySelectorAll("[data-crop-handle]")).toHaveLength(4);
  });

  it("starts from the image's current crop", () => {
    setup(image({ crop: { x: 0.25, y: 0.1, width: 0.5, height: 0.6 } }));
    expect(box()).toHaveAttribute("data-crop", "0.250,0.100,0.500,0.600");
    expect(box()).toHaveStyle({ left: "25%", top: "10%", width: "50%" });
  });

  it("resets to the whole image", async () => {
    const user = userEvent.setup();
    setup(image({ crop: { x: 0.25, y: 0.1, width: 0.5, height: 0.6 } }));
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(box()).toHaveAttribute("data-crop", "0.000,0.000,1.000,1.000");
    // Nothing is saved until Apply.
    expect(saved().crop).toEqual({ x: 0.25, y: 0.1, width: 0.5, height: 0.6 });
  });

  describe("keyboard", () => {
    it("moves the box 1% per arrow key and 5% with Shift", async () => {
      const user = userEvent.setup();
      setup(image({ crop: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 } }));
      box().focus();
      await user.keyboard("{ArrowRight}");
      expectCrop(shownCrop(), { x: 0.21, y: 0.2, width: 0.5, height: 0.5 });
      await user.keyboard("{ArrowDown}{ArrowDown}");
      expectCrop(shownCrop(), { x: 0.21, y: 0.22, width: 0.5, height: 0.5 });
      await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
      expectCrop(shownCrop(), { x: 0.16, y: 0.22, width: 0.5, height: 0.5 });
      await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
      expectCrop(shownCrop(), { x: 0.16, y: 0.17, width: 0.5, height: 0.5 });
      await user.keyboard("{ArrowUp}");
      expectCrop(shownCrop(), { x: 0.16, y: 0.16, width: 0.5, height: 0.5 });
    });

    it("keeps the box inside the image", async () => {
      const user = userEvent.setup();
      setup(image({ crop: { x: 0.47, y: 0.02, width: 0.5, height: 0.5 } }));
      box().focus();
      await user.keyboard("{Shift>}{ArrowRight}{ArrowUp}{/Shift}");
      expectCrop(shownCrop(), { x: 0.5, y: 0, width: 0.5, height: 0.5 });
    });

    it("ignores other keys and can't move a full crop", async () => {
      const user = userEvent.setup();
      setup();
      box().focus();
      await user.keyboard("a{Enter}{ArrowRight}{Shift>}{ArrowDown}{/Shift}");
      expect(box()).toHaveAttribute("data-crop", "0.000,0.000,1.000,1.000");
    });
  });

  describe("pointer", () => {
    it("drags the box to move it", () => {
      setup(image({ crop: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 } }));
      // 40px of 400 = 10%, 20px of 200 = 10%.
      drag(box(), [40, 20]);
      expectCrop(shownCrop(), { x: 0.3, y: 0.3, width: 0.5, height: 0.5 });
    });

    it("keeps a dragged box inside the image", () => {
      setup(image({ crop: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 } }));
      drag(box(), [-1000, 1000]);
      expectCrop(shownCrop(), { x: 0, y: 0.5, width: 0.5, height: 0.5 });
    });

    it("resizes from each corner", () => {
      setup();
      drag(handle("se"), [-100, -50]);
      expectCrop(shownCrop(), { x: 0, y: 0, width: 0.75, height: 0.75 });
      drag(handle("nw"), [40, 20]);
      expectCrop(shownCrop(), { x: 0.1, y: 0.1, width: 0.65, height: 0.65 });
      drag(handle("ne"), [40, 20]);
      expectCrop(shownCrop(), { x: 0.1, y: 0.2, width: 0.75, height: 0.55 });
      drag(handle("sw"), [-40, 20]);
      expectCrop(shownCrop(), { x: 0, y: 0.2, width: 0.85, height: 0.65 });
    });

    it("dragging a corner doesn't also move the box", () => {
      setup(image({ crop: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 } }));
      drag(handle("se"), [40, 20]);
      expectCrop(shownCrop(), { x: 0.2, y: 0.2, width: 0.6, height: 0.6 });
    });

    it("never makes the box smaller than MIN_CROP", () => {
      setup();
      drag(handle("se"), [-10_000, -10_000]);
      expectCrop(shownCrop(), { x: 0, y: 0, width: MIN_CROP, height: MIN_CROP });
    });

    it("measures each drag from where it started", () => {
      setup(image({ crop: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 } }));
      fireEvent.pointerDown(box(), { button: 0, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(window, { clientX: 140, clientY: 100 });
      fireEvent.pointerMove(window, { clientX: 120, clientY: 100 });
      expectCrop(shownCrop(), { x: 0.25, y: 0.2, width: 0.5, height: 0.5 });
      fireEvent.pointerUp(window);
    });

    it("stops following the pointer after it is released or cancelled", () => {
      setup(image({ crop: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 } }));
      drag(box(), [40, 0]);
      fireEvent.pointerMove(window, { clientX: 300, clientY: 300 });
      expectCrop(shownCrop(), { x: 0.3, y: 0.2, width: 0.5, height: 0.5 });
      fireEvent.pointerDown(box(), { button: 0, clientX: 0, clientY: 0 });
      fireEvent.pointerCancel(window);
      fireEvent.pointerMove(window, { clientX: 40, clientY: 0 });
      expectCrop(shownCrop(), { x: 0.3, y: 0.2, width: 0.5, height: 0.5 });
    });

    it("ignores buttons other than the primary one", () => {
      setup(image({ crop: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 } }));
      drag(box(), [40, 20], { button: 2 });
      drag(handle("se"), [40, 20], { button: 1 });
      expectCrop(shownCrop(), { x: 0.2, y: 0.2, width: 0.5, height: 0.5 });
    });

    it("ignores pointer moves without a drag or while the frame has no size", () => {
      setup(image({ crop: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 } }));
      fireEvent.pointerMove(window, { clientX: 300, clientY: 300 });
      expectCrop(shownCrop(), { x: 0.2, y: 0.2, width: 0.5, height: 0.5 });
      vi.mocked(screen.getByTestId("crop-frame").getBoundingClientRect).mockReturnValue(DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 }));
      drag(box(), [40, 20]);
      expectCrop(shownCrop(), { x: 0.2, y: 0.2, width: 0.5, height: 0.5 });
    });
  });

  describe("applying", () => {
    it("writes the crop and keeps the picture's scale and position", async () => {
      const user = userEvent.setup();
      const { onClose } = setup();
      drag(handle("nw"), [100, 50]);
      await user.click(screen.getByRole("button", { name: "Apply" }));
      expectCrop(saved().crop, { x: 0.25, y: 0.25, width: 0.75, height: 0.75 });
      expect(saved()).toMatchObject({ x: 200, y: 150, width: 300, height: 150 });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(editor().past).toHaveLength(1);
    });

    it("crops from the bottom-right without moving the element", async () => {
      const user = userEvent.setup();
      setup();
      drag(handle("se"), [-200, -100]);
      await user.click(screen.getByRole("button", { name: "Apply" }));
      expectCrop(saved().crop, { x: 0, y: 0, width: 0.5, height: 0.5 });
      expect(saved()).toMatchObject({ x: 100, y: 100, width: 200, height: 100 });
    });

    it("removes the crop and restores the full picture after Reset", async () => {
      const user = userEvent.setup();
      setup(image({ x: 200, y: 150, width: 200, height: 100, crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } }));
      await user.click(screen.getByRole("button", { name: "Reset" }));
      await user.click(screen.getByRole("button", { name: "Apply" }));
      expect(saved().crop).toBeUndefined();
      expect("crop" in saved()).toBe(false);
      expect(saved()).toMatchObject({ x: 100, y: 100, width: 400, height: 200 });
    });

    it("scales an un-cropped picture down to fit on the slide", async () => {
      const user = userEvent.setup();
      setup(image({ x: 0, y: 0, width: 1000, height: 500, crop: { x: 0, y: 0, width: 0.5, height: 0.5 } }));
      await user.click(screen.getByRole("button", { name: "Reset" }));
      await user.click(screen.getByRole("button", { name: "Apply" }));
      expect(saved().crop).toBeUndefined();
      expect(saved()).toMatchObject({ x: 0, y: 0, width: SLIDE_WIDTH, height: 640 });
    });

    it("applies a crop moved with the keyboard", async () => {
      const user = userEvent.setup();
      setup(image({ x: 200, y: 150, width: 200, height: 100, crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } }));
      box().focus();
      await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
      await user.click(screen.getByRole("button", { name: "Apply" }));
      expectCrop(saved().crop, { x: 0.3, y: 0.25, width: 0.5, height: 0.5 });
      // 5% of the full 400px picture.
      expect(saved()).toMatchObject({ x: 220, y: 150, width: 200, height: 100 });
    });

    it("records nothing when the crop didn't change", async () => {
      const user = userEvent.setup();
      const { onClose, img } = setup();
      await user.click(screen.getByRole("button", { name: "Apply" }));
      expect(onClose).toHaveBeenCalled();
      expect(saved()).toEqual(img);
      expect(editor().past).toHaveLength(0);
    });

    it("leaves a locked image unchanged", async () => {
      const user = userEvent.setup();
      const { img } = setup(image({ locked: true }));
      drag(handle("se"), [-200, -100]);
      await user.click(screen.getByRole("button", { name: "Apply" }));
      expect(saved()).toEqual(img);
    });
  });

  it("cancel does nothing to the image", async () => {
    const user = userEvent.setup();
    const { onClose, img } = setup(image({ crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } }));
    drag(handle("se"), [40, 20]);
    await user.click(screen.getByRole("button", { name: "Reset" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(saved()).toEqual(img);
    expect(editor().past).toHaveLength(0);
  });

  it("closing with Escape does nothing to the image", async () => {
    const user = userEvent.setup();
    const { onClose, img } = setup();
    drag(handle("se"), [-100, -50]);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(saved()).toEqual(img);
  });
});
