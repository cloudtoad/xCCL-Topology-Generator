/** Half-extent of each node shape — used to stop links at the edge. */
export function nodeRadius(id: string): number {
  if (id.includes('gpu-')) return 0.25
  if (id.includes('cpu-')) return 0.3
  if (id.includes('nic-')) return 0.175
  if (id.includes('nvs-')) return 0.25
  if (id.includes('pci-')) return 0.2
  if (id.includes('net-')) return 0.4
  return 0.2
}
