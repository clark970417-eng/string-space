import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
export function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);
  useEffect(() => {
    const d = ref.current!;
    const before = document.activeElement;
    d.showModal();
    return () => {
      d.close();
      if (before instanceof HTMLElement) before.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "dialog wide" : "dialog"}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label={title}
      onPointerDown={(e) => {
        const r = ref.current!.getBoundingClientRect();
        backdropPress.current =
          e.target === ref.current &&
          (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
      }}
      onClick={(e) => {
        const r = ref.current!.getBoundingClientRect();
        if (
          backdropPress.current &&
          e.target === ref.current &&
          (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        )
          onClose();
        backdropPress.current = false;
      }}
    >
      <header className="dialog-head">
        <div>
          <span className="eyebrow">STRING SPACE</span>
          <h2>{title}</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="關閉視窗">
          <X size={20} />
        </button>
      </header>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
