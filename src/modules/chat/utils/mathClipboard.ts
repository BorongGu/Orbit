import { serializeSelectionRange } from '@/shared/utils';

/** Markdown installs this once so native copy also works across streamed blocks, messages and BTW panels. */
export function copyMathSelection(event: ClipboardEvent): void {
  if (event.defaultPrevented || !event.clipboardData) return;
  if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable="true"]')) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return;
  const formulas = Array.from(document.querySelectorAll<HTMLElement>('.katex'));
  const ranges = Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange());
  if (!ranges.some(range => formulas.some(math => range.intersectsNode(math)))) return;

  const serialized = ranges.map(range => serializeSelectionRange(range));
  event.clipboardData.setData('text/plain', serialized.map(value => value.text).join('\n'));
  event.clipboardData.setData('text/html', serialized.map(value => value.html).join('<br>'));
  event.preventDefault();
}
