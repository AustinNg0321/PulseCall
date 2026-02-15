import { render, screen } from "@testing-library/react";

import { SentimentBadge } from "./SentimentBadge";

describe("SentimentBadge", () => {
  it("renders mapped label for known score", () => {
    render(<SentimentBadge score={4} />);
    expect(screen.getByText("Positive")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("falls back to neutral label for unknown score", () => {
    render(<SentimentBadge score={99} />);
    expect(screen.getByText("Neutral")).toBeInTheDocument();
  });
});

