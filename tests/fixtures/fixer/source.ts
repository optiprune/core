export const heartbeat = {
  keep: () => true,
  remove: () => {
    return false;
  },
};

export function healthy(): boolean {
  return heartbeat.keep();
}
