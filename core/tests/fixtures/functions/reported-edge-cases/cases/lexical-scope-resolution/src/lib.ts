export const selfInitialized = 1;
export const parameterShadowed = 2;
export const parameterDefaultOuter = 3;

function selfInitializer() {
  const selfInitialized = selfInitialized;
  return selfInitialized;
}

function parameterUsesLocal(parameterShadowed = 0) {
  return parameterShadowed;
}

function bodyLocalDoesNotShadowParameterDefault(value = parameterDefaultOuter) {
  const parameterDefaultOuter = 4;
  return value + parameterDefaultOuter;
}

void selfInitializer;
void parameterUsesLocal;
void bodyLocalDoesNotShadowParameterDefault;
