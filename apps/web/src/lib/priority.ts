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
      tone: "text-slate-300",
    };
  }

  if (priority <= 50) {
    return {
      label: "Medium / Functional Flaw",
      range: "26–50%",
      tone: "text-cyan-300",
    };
  }

  if (priority <= 75) {
    return {
      label: "High / Flow Blocked",
      range: "51–75%",
      tone: "text-amber-300",
    };
  }

  return {
    label: "Critical / System Blocker / Data Loss",
    range: "76–100%",
    tone: "text-rose-300",
  };
}
