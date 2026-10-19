import { Fragment } from 'react';
import { linkifyMessage } from '@/lib/utils/linkify';

/** React escapes message text; never interpret a message as HTML. */
export function LinkifiedText({ text }: { text: string }) {
  return <>{linkifyMessage(text).map((part, index) => part.href ? (
    <a key={index} href={part.href} target="_blank" rel="noopener noreferrer"
      className="text-[#9FE8D8] underline underline-offset-4 decoration-[#9FE8D8]/70 hover:text-[#CFFBF1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9FE8D8] break-all">
      {part.text}
    </a>
  ) : <Fragment key={index}>{part.text}</Fragment>)}</>;
}
