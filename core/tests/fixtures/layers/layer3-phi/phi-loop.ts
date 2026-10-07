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
