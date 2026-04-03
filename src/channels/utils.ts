/**
 * Split a message into chunks at line boundaries, respecting a character limit.
 * Falls back to hard splits if individual lines exceed the limit.
 */
export function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let current = '';

  for (const line of text.split('\n')) {
    if (current.length + line.length + 1 > maxLength) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      // Handle single lines longer than maxLength
      if (line.length > maxLength) {
        for (let i = 0; i < line.length; i += maxLength) {
          chunks.push(line.slice(i, i + maxLength));
        }
        continue;
      }
    }
    current = current ? `${current}\n${line}` : line;
  }
  if (current) chunks.push(current);

  return chunks;
}
