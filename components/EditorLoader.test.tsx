import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import EditorLoader from "./EditorLoader";
import Home from "@/app/page";

vi.mock("./Editor", () => ({ default: () => <div>Editor loaded</div> }));

describe("EditorLoader", () => {
  it("loads the client-only editor", async () => {
    render(<EditorLoader />);
    expect(await screen.findByText("Editor loaded")).toBeInTheDocument();
  });

  it("is what the home page renders", async () => {
    render(<Home />);
    expect(await screen.findByText("Editor loaded")).toBeInTheDocument();
  });
});
