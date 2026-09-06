import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SubtopicChips from "./SubtopicChips";

describe("SubtopicChips", () => {
  it("renders nothing when subtopics is missing or empty", () => {
    const { container: c1 } = render(<SubtopicChips onFollowUp={() => {}} />);
    expect(c1).toBeEmptyDOMElement();
    const { container: c2 } = render(
      <SubtopicChips subtopics={[]} onFollowUp={() => {}} />,
    );
    expect(c2).toBeEmptyDOMElement();
  });

  it("renders a chip per subtopic", () => {
    render(
      <SubtopicChips
        subtopics={[
          { title: "GPT-6 safety card", prompt: "Explain the safety system card" },
          { title: "Lean formalization", prompt: "How does AI-assisted math verification work?" },
        ]}
        onFollowUp={() => {}}
      />,
    );
    expect(screen.getByText("GPT-6 safety card")).toBeInTheDocument();
    expect(screen.getByText("Lean formalization")).toBeInTheDocument();
  });

  it("falls back to the prompt text when title is missing", () => {
    render(
      <SubtopicChips
        subtopics={[{ prompt: "A prompt with no title" }]}
        onFollowUp={() => {}}
      />,
    );
    expect(screen.getByText("A prompt with no title")).toBeInTheDocument();
  });

  it("calls onFollowUp with the subtopic prompt on click", () => {
    const onFollowUp = vi.fn();
    render(
      <SubtopicChips
        subtopics={[{ title: "Drill in", prompt: "Tell me more about X" }]}
        onFollowUp={onFollowUp}
      />,
    );
    fireEvent.click(screen.getByText("Drill in"));
    expect(onFollowUp).toHaveBeenCalledWith("Tell me more about X");
  });

  it("disables chips (and does not call onFollowUp) when onFollowUp is null", () => {
    const onFollowUp = vi.fn();
    render(
      <SubtopicChips
        subtopics={[{ title: "Drill in", prompt: "Tell me more about X" }]}
        onFollowUp={null}
      />,
    );
    const chip = screen.getByText("Drill in").closest("button");
    expect(chip).toBeDisabled();
    fireEvent.click(chip);
    expect(onFollowUp).not.toHaveBeenCalled();
  });
});