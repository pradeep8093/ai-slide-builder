import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import EditorLoader from "./EditorLoader";
import Home from "@/app/page";

vi.mock("./App", () => ({ default: () => <div>App loaded</div> }));

describe("EditorLoader", () => {
  it("loads the client-only app (dashboard + editor shell)", async () => {
    render(<EditorLoader />);
    expect(await screen.findByText("App loaded")).toBeInTheDocument();
  });

  it("is what the home page renders", async () => {
    render(<Home />);
    expect(await screen.findByText("App loaded")).toBeInTheDocument();
  });
});
