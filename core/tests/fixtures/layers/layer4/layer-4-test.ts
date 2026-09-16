export function dynamicBranch(x: number) {
    if (x > 10) {
        console.log("x is greater than 10");
    } else {
        console.log("x is not greater than 10");
    }
}

export function multipleBranches(a: number, b: number) {
    if (a > 5) {
        if (b < 0) {
            console.log("a > 5 and b < 0");
        } else {
            console.log("a > 5 and b >= 0");
        }
    } else {
        console.log("a <= 5");
    }
}

export function unreachableConcolicPath(input: number) {
    if (input > 100) {
        if (input < 50) {
            console.log("This path is impossible to reach concolically");
        }
    }
}
