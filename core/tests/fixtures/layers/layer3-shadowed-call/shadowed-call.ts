function shadowableCall() { return 1; }

export function shadowedCall(value: number) {
  if (value() === 2) {
    console.log("The parameter binding must not be folded as shadowableCall");
  }
}
