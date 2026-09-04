import path from 'pathe';

export async function start() {
  const name = "my-plugin";
  // String interpolation in dynamic import (flat structure for test)
  const module = await import(`./plugins/${name}.ts`);
  console.log("Loaded:", module.default.name);
}
