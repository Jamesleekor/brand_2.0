export type MessageTextPart = { text: string; href?: string };

/** Keep the original plain text intact; only HTTP(S) web addresses become links. */
export function linkifyMessage(text: string): MessageTextPart[] {
  const parts: MessageTextPart[] = [];
  const pattern = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    // Do not turn the middle of a word or an email address into a web link.
    if (match.index > 0 && /[\p{L}\p{N}_@]/u.test(text[match.index - 1])) continue;
    let address = match[0];
    // Sentence punctuation and surrounding brackets are not part of the URL.
    while (address) {
      if (/[.,!?;:。！？、，…’”」』]$/u.test(address)) {
        address = address.slice(0, -1);
        continue;
      }
      const last = address.slice(-1);
      const opening = ({ ')': '(', ']': '[', '}': '{' } as Record<string, string>)[last];
      if (opening && address.split(last).length > address.split(opening).length) {
        address = address.slice(0, -1);
        continue;
      }
      break;
    }

    try {
      const url = new URL(/^www\./i.test(address) ? `https://${address}` : address);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) continue;
      if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index) });
      parts.push({ text: address, href: url.href });
      cursor = match.index + address.length;
    } catch {
      // Invalid web addresses remain ordinary text.
    }
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}
