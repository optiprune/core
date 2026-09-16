export function complexLogic(x: number, y: number) {
    if (x > 10 && x < 5) {
        console.log("Mathematically impossible: x cannot be > 10 and < 5 at the same time");
    }

    if (x === 1) {
        if (x === 2) {
            console.log("Impossible: x cannot be 1 and 2");
        }
    }
}

export function rangeLogic(age: number) {
    if (age < 0) {
        if (age > 150) {
            console.log("Impossible: age cannot be < 0 and > 150");
        }
    }
}

function a() { return 1; }
function b() { return -1; }

export function functionComparison() {
    if (a() === b()) {
        console.log("Impossible: 1 is not -1");
    }
}
