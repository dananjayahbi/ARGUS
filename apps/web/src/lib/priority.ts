export interface PriorityTier {
  label: string;
  range: string;
  tone: string;
}

export function priorityTier(priority: number): PriorityTier {
  if (priority <= 25) {
    return {
      label: "Low / Cosmetic",
      range: "0–25%",
      tone: "text-ink-soft",
    };
  }

  if (priority <= 50) {
    return {
      label: "Medium / Functional Flaw",
      range: "26–50%",
      tone: "text-teal",
    };
  }

  if (priority <= 75) {
    return {
      label: "High / Flow Blocked",
      range: "51–75%",
      tone: "text-accent-strong",
    };
  }

  return {
    label: "Critical / System Blocker / Data Loss",
    range: "76–100%",
    tone: "text-bad",
  };
}
