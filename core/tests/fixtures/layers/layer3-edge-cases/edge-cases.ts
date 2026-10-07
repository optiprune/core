export function terminatingLoop() {
  let i = 0;
  while (i < 3) {
    i = i + 1;
  }
}

export function doWhileRunsOnce() {
  let value = 0;
  do value = 1;
  while (false);
  if (value === 0) console.log("unreachable after do-while");
}

export function doWhileContradictoryTest(start: number) {
  do {
    start = start + 1;
  } while (start < 0 && start >= 0);
}

export function doWhileTerminatesNaturally() {
  let count = 0;
  do {
    count = count + 1;
  } while (count < 2);
}

export function unbracedBranch(cond: boolean) {
  let x = 0;
  if (cond) x = 1;
  else x = 2;
  if (x === 0) console.log("unreachable after unbraced branch");
}

export function returnBranch(cond: boolean) {
  let x = 0;
  if (cond) {
    x = 1;
    return;
  }
  if (x === 1) console.log("unreachable after return branch");
}

export function nestedReturnBranch(cond: boolean, flag: boolean) {
  let x = 0;
  if (cond) {
    {
      return;
    }
  } else if (flag) {
    return;
  } else {
    return;
  }
  x = 1;
}

export function forWithoutInitOrUpdate(cond: boolean) {
  for (; cond; ) {
    break;
  }
}

export function forWithoutCondition() {
  for (;;) {
    break;
  }
}
