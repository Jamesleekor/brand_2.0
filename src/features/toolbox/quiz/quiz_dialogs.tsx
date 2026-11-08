// =====================================================================
// 퀴즈 로얄 — 사유를 받는 확인 창 (무효·재출제·정정·강제 진행 등은 사유가 기록에 남는다)
// =====================================================================

import { useCallback, useState, type ReactNode } from 'react';
import { Modal } from '../ui';

export function useReasonDialog() {
  const [req, setReq] = useState<{ title: string; body: ReactNode; confirm: string; danger?: boolean; placeholder?: string; resolve: (v: string | null) => void } | null>(null);
  const [text, setText] = useState('');
  const ask = useCallback((title: string, body: ReactNode, confirm = '확인', opts: { danger?: boolean; placeholder?: string; initial?: string } = {}) =>
    new Promise<string | null>((resolve) => { setText(opts.initial ?? ''); setReq({ title, body, confirm, danger: opts.danger, placeholder: opts.placeholder, resolve }); }), []);
  const close = (v: string | null) => { req?.resolve(v); setReq(null); };
  const dialog = (
    <Modal open={!!req} onClose={() => close(null)} title={req?.title ?? ''}
      footer={<>
        <button type="button" className="tbx-btn" onClick={() => close(null)}>취소</button>
        <button type="button" className={req?.danger ? 'tbx-btn tbx-btn--danger' : 'tbx-btn tbx-btn--brass'} disabled={!text.trim()}
          onClick={() => close(text.trim())}>{req?.confirm}</button>
      </>}>
      <div className="tbx-stack">
        <div className="tbx-body" style={{ color: 'var(--tbx-ivory)' }}>{req?.body}</div>
        <label className="tbx-label" htmlFor="qz-reason">사유 (기록에 남아요)</label>
        <input id="qz-reason" className="tbx-input" maxLength={200} value={text} autoFocus placeholder={req?.placeholder ?? '예: 태블릿 와이파이 끊김'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && text.trim()) close(text.trim()); }} />
      </div>
    </Modal>
  );
  return { ask, dialog };
}
