// B.R.A.N.D. mail attachments — render trusted notice image links as previews.
// Ordinary messages remain plain, safely linkified text.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { LinkifiedText } from '@/components/shared/LinkifiedText';
import { linkifyMessage } from '@/lib/utils/linkify';

const MAX_IMAGES = 8;

function isBrandNoticeImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !/\.(?:png|jpe?g|webp)$/i.test(url.pathname)) return false;
    const cdn = url.hostname === 'cdn.jsdelivr.net'
      && url.pathname.startsWith('/gh/Jamesleekor/brand-assets@main/');
    const raw = url.hostname === 'raw.githubusercontent.com'
      && url.pathname.startsWith('/Jamesleekor/brand-assets/main/');
    return cdn || raw;
  } catch {
    return false;
  }
}

function imageCaption(url: string, index: number): string {
  const file = new URL(url).pathname.split('/').pop() || '';
  if (file.includes('auction8_01_balance')) return '11월 균형발전 분담금';
  if (file.includes('auction8_02_seats_meals')) return '제8회 자리·급식 경매 시작가';
  if (file.includes('auction8_03_jobs')) return '11월 1인1역 시작가·일급';
  return `첨부 이미지 ${index + 1}`;
}

export function MailRichBody({ text, allowImagePreviews }: {
  text: string;
  allowImagePreviews: boolean;
}) {
  const [activeUrl, setActiveUrl] = useState<string | null>(null);

  const { messageText, imageUrls } = useMemo(() => {
    if (!allowImagePreviews) return { messageText: text, imageUrls: [] as string[] };
    const parts = linkifyMessage(text);
    const urls = [...new Set(parts
      .filter((part) => part.href && isBrandNoticeImageUrl(part.href))
      .map((part) => part.href as string))].slice(0, MAX_IMAGES);
    const visibleText = parts.map((part) => {
      return part.href && urls.includes(part.href) ? '' : part.text;
    }).join('').replace(/\n[\t ]*\n[\t ]*\n/g, '\n\n').trim();

    return { messageText: visibleText, imageUrls: urls };
  }, [text, allowImagePreviews]);

  useEffect(() => {
    if (!activeUrl) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveUrl(null);
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [activeUrl]);

  return (
    <>
      {messageText && (
        <div className="whitespace-pre-wrap break-words">
          <LinkifiedText text={messageText} />
        </div>
      )}

      {imageUrls.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-bold text-[#DCC48E] mb-2">
            📜 첨부 공고문 · 누르면 크게 볼 수 있습니다
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {imageUrls.map((url, index) => (
              <button
                key={url}
                type="button"
                onClick={() => setActiveUrl(url)}
                aria-label={`${imageCaption(url, index)} 확대 보기`}
                className="overflow-hidden rounded-xl border border-[#DCC48E]/35 bg-[#101927] text-left hover:border-[#DCC48E]/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#DCC48E]"
              >
                <img
                  src={url}
                  alt={imageCaption(url, index)}
                  loading="lazy"
                  decoding="async"
                  className="w-full aspect-[3/4] object-contain"
                />
                <span className="block px-2 py-2 text-[11px] leading-snug font-semibold text-[#F3EBD3]">
                  {imageCaption(url, index)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {activeUrl && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[1200] flex flex-col bg-black/95 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="공고문 이미지 확대 보기"
          onClick={() => setActiveUrl(null)}
        >
          <div className="flex items-center justify-between gap-3 text-[#F3EBD3] pb-3">
            <span className="text-sm font-bold">📜 공고문 확대 보기</span>
            <div className="flex items-center gap-3">
              <a
                href={activeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs underline underline-offset-4"
                onClick={(event) => event.stopPropagation()}
              >
                원본 열기
              </a>
              <button
                type="button"
                onClick={() => setActiveUrl(null)}
                className="px-3 py-2 rounded-lg bg-white/15 text-sm font-bold"
                aria-label="확대 화면 닫기"
              >
                ✕ 닫기
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 flex items-center justify-center" onClick={(event) => event.stopPropagation()}>
            <img
              src={activeUrl}
              alt="확대된 공고문"
              className="max-w-full max-h-full object-contain"
            />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
