export function phiJoin(flag: boolean) {
  let value = 0;
  if (flag) {
    value = 1;
  } else {
    value = 2;
  }

  if (value === 1 && value === 2) {
    console.log("unreachable after phi join");
  }
}

export function impossibleWhile(start: number) {
  while (start < 0 && start >= 0) {
    start = start + 1;
  }
}

export function loopState(flag: boolean) {
  let value = 0;
  while (flag) {
    value = 1;
    flag = false;
  }
  if (value === 0 && flag) {
    console.log("unreachable after loop phi");
  }
}

export function counterLoop(limit: number) {
  let index = 0;
  while (index < limit) {
    index++;
  }
  if (index < 0) {
    console.log("unreachable after counter loop");
  }
}

export function loopWithEarlyExit(flag: boolean) {
  let value = 0;
  while (flag) {
    value = 1;
    if (flag) return value;
    flag = false;
  }
  if (value !== 0 && value !== 1) {
    console.log("unreachable after early exit");
  }
}

export function loopWithSwitchBreak(flag: boolean, action: "a" | "b") {
  let value = 0;
  while (flag) {
    switch (action) {
      case "a":
        value = 1;
        break;
      case "b":
        value = 2;
        break;
    }
    flag = false;
  }
  if (value === 3) {
    console.log("unreachable after switch");
  }
}

export function loopWithLabeledBreak(flag: boolean) {
  let value = 0;
  outer: while (flag) {
    while (flag) {
      value = 1;
      break outer;
    }
    flag = false;
  }
  if (value === 0 && flag) {
    console.log("unreachable after labeled break");
  }
}
