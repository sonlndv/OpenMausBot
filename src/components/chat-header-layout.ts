export function chatHeaderContainer(tiled: boolean, simple: boolean): string {
  if (tiled) return "@container/chathead ps-3 pe-11 py-2 max-md:ps-14";
  return simple
    ? "@container/chathead px-5 pt-2.5 pb-2.5 max-md:ps-14 max-md:pe-3"
    : "@container/chathead px-5 py-3 ps-11 md:ps-5 max-md:ps-14 max-md:pe-3";
}
