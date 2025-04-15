// Helper to parse SSE lines
export function processSSELine(line: string, currentEvent: { id: string | null; event: string; data: string }) {
  if (line.startsWith('id:')) {
    currentEvent.id = line.substring(3).trim();
  } else if (line.startsWith('event:')) {
    currentEvent.event = line.substring(6).trim();
  } else if (line.startsWith('data:')) {
    const dataLine = line.substring(5).trim();
    currentEvent.data = currentEvent.data ? `${currentEvent.data}\n${dataLine}` : dataLine;
  } else if (line === '') {
    if (currentEvent.data) {
      const eventToDispatch = { ...currentEvent };
      currentEvent.data = '';
      currentEvent.event = 'message'; // Reset to default
      return eventToDispatch;
    }
    currentEvent.event = 'message'; // Reset even if no data
  }
  return null;
}
