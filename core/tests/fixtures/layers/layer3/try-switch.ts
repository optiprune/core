export function impossibleInTry(value: number): string {
  try {
    if (value > 2 && value < 0) return "dead";
  } catch {
    return "caught";
  }
  return "live";
}

export function impossibleInSwitch(value: number): string {
  switch (0) {
    case 0:
      if (value > 2 && value < 0) return "dead";
      return "live";
    default:
      return "other";
  }
}
