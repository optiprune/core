import { Sizes, Shadow } from "./library";
const local = Sizes.Size;
const nested = Sizes.Inner.Deep;
console.log(local, nested, Sizes.use(), Shadow.read(1));
