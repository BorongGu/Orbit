import assert from 'node:assert/strict';

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import ChatInterface from '@/modules/chat/ChatInterface';
import { useMarkdownWorkspaceProjectId } from '@/modules/chat/context/MarkdownWorkspaceContext';
import { BtwPanel } from '@/modules/chat/modals/BtwPanel';
import { contextTransferApi, notesApi } from '@/shared/api';
import type { BtwRequest } from '@/shared/types';

vi.mock('@/modules/chat/transcript/Markdown', () => ({
  Markdown: ({ children }: any) => <div data-markdown-project={useMarkdownWorkspaceProjectId()}>{children}</div>,
  MarkdownBody: ({ children }: any) => <div data-markdown-project={useMarkdownWorkspaceProjectId()}>{children}</div>,
}));
// Frame pacing is covered by progressiveText tests; keep socket lifecycle assertions immediate.
vi.mock('@/modules/chat/hooks/useProgressiveText', () => ({ useProgressiveText: (content: string) => content }));
// Keep the real ChatInterface-to-BtwPanel lifecycle; unrelated main-chat work is stubbed.
const composer = vi.hoisted(() => ({ openBtw: (_question: string) => {} }));
vi.mock('@/modules/task-master', () => ({ useTasksSettings: () => ({}) }));
vi.mock('@/modules/command-palette', () => ({ usePaletteOpsRegister: () => {} }));
vi.mock('@/shared/context/WebSocketContext', () => ({ useWebSocket: () => ({ subscribe() {} }) }));
vi.mock('@/shared/context/SessionProtectionContext', () => ({
  useProcessingSessions: () => new Set(), useSessionProtectionActions: () => ({}),
}));
vi.mock('@/modules/chat/hooks/useChatProviderState', () => ({ useChatProviderState: ({ selectedSession }: any) => ({
  provider: selectedSession.provider, currentProviderModel: selectedSession.provider === 'codex' ? 'gpt-6.1-sol' : 'opencode-go/glm-5.3-flash',
  currentProviderEffort: 'low', permissionMode: 'bypassPermissions', pendingPermissionRequests: [],
}) }));
vi.mock('@/modules/chat/hooks/useChatSessionState', () => ({ useChatSessionState: ({ selectedSession }: any) => ({ chatMessages: [], currentSessionId: selectedSession.id }) }));
vi.mock('@/modules/chat/hooks/useSessionStore', () => ({ useSessionStore: () => ({}) }));
vi.mock('@/modules/chat/hooks/useChatRealtimeHandlers', () => ({ useChatRealtimeHandlers() {} }));
vi.mock('@/modules/chat/composer/useScheduledMessages', () => ({ useScheduledMessages: () => ({ scheduledMessages: [] }) }));
vi.mock('@/modules/chat/hooks/useChatComposerState', () => ({ useChatComposerState: ({ onOpenBtw }: any) => {
  composer.openBtw = onOpenBtw;
  return { input: '', textareaRef: { current: null } };
} }));
vi.mock('@/modules/chat/transcript/ChatMessagesPane', () => ({ default: () => null }));
vi.mock('@/modules/chat/composer/ChatComposer', () => ({ default: ({ onRestoreBtw }: { onRestoreBtw?: () => void }) =>
  onRestoreBtw ? <button type="button" onClick={onRestoreBtw}>恢复 BTW 窗口</button> : null }));
vi.mock('@/modules/chat/composer/CodexGoalPanel', () => ({ CodexGoalPanel: () => null }));
vi.mock('@/modules/chat/modals/CommandResultModal', () => ({ default: () => null }));
const instances: FakeSocket[] = [];
class FakeSocket {
  static CONNECTING = 0;static OPEN = 1;static CLOSED = 3;
  readyState = 0;
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) { instances.push(this); }
  open() { this.readyState = 1;this.onopen?.(); }
  frame(data: any) { this.onmessage?.({ data: JSON.stringify(data) }); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3;this.onclose?.(); }
}
const REQUEST: BtwRequest = { key: 'window', sessionId: 'parent', question: 'Initial side question', model: 'gpt-6.1-sol', effort: 'low', provider: 'codex' };
beforeEach(() => {
  sessionStorage.clear();
  instances.length = 0;vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('innerWidth', 1200);vi.stubGlobal('innerHeight', 900);
  // jsdom lacks PointerEvent; preserve pointer identity and mouse/touch semantics.
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number;isPrimary: boolean;pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);this.pointerId = init.pointerId ?? 1;this.isPrimary = init.isPrimary ?? true;this.pointerType = init.pointerType ?? 'mouse';
    }
  });
});
afterEach(() => { cleanup();vi.useRealTimers();vi.unstubAllGlobals(); });

test('selected BTW output saves with its parent and side-window provenance, then opens the note', async () => {
  const save=vi.spyOn(notesApi,'create').mockResolvedValue({id:'saved-side-note'} as never);const open=vi.fn();
  Range.prototype.getBoundingClientRect=()=>({x:10,y:10,left:10,right:200,top:10,bottom:40,width:190,height:30,toJSON(){}});
  const view=render(<BtwPanel request={REQUEST} onOpenNote={open} onClose={()=>{}}/>);
  try {
    const socket=instances[0];act(()=>{socket.open();socket.frame({kind:'btw_ready'});socket.frame({kind:'btw_message',id:'answer',role:'assistant',content:'A side discussion conclusion'});});
    act(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('[data-note-message="answer"]')!);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);fireEvent(document,new Event('selectionchange'));});
    fireEvent.click(view.getByRole('button',{name:'保存为笔记'}));
    fireEvent.click(await view.findByRole('button',{name:'已保存 · 查看笔记'}));
    assert.equal(save.mock.calls[0][0].content,'A side discussion conclusion');
    assert.equal(save.mock.calls[0][0].sourceSessionId,'parent');assert.equal(save.mock.calls[0][0].sourceConversationId,'window');
    assert.equal(save.mock.calls[0][0].sourceKind,'btw');assert.equal(save.mock.calls[0][0].sourceModel,REQUEST.model);
    assert.deepEqual(open.mock.calls,[['saved-side-note']]);
  } finally {save.mockRestore();window.getSelection()?.removeAllRanges();}
});

test('minimizing hides the portal while its native request, reply, draft and size stay alive', () => {
  const onMinimize = vi.fn();
  const view = render(<BtwPanel request={REQUEST} onMinimize={onMinimize} onClose={() => {}} />);
  const socket = instances[0];
  act(() => { socket.open();socket.frame({ kind: 'btw_ready' });
    socket.frame({ kind: 'btw_message', id: 'answer', role: 'assistant', content: 'Answer before minimize' }); });
  const panel = view.getByRole('dialog');mockPanelBounds(panel);
  fireEvent.change(view.getByRole('textbox'), { target: { value: 'Saved follow-up' } });
  const bounds = panelBounds(panel);
  fireEvent.click(view.getByRole('button', { name: /Minimize side conversation|最小化临时对话/ }));
  assert.equal(onMinimize.mock.calls.length, 1);
  view.rerender(<BtwPanel request={{ ...REQUEST, minimized: true }} onMinimize={onMinimize} onClose={() => {}} />);
  assert.equal(view.queryByRole('dialog'), null);
  assert.equal(document.querySelector('[data-btw-panel]'), null);
  assert.equal(socket.readyState, FakeSocket.OPEN);
  assert.equal(socket.sent.some(message => message.type === 'finish'), false);
  act(() => { socket.frame({ kind: 'btw_message', id: 'answer', role: 'assistant', content: 'Answer completed while minimized' }); });
  view.rerender(<BtwPanel request={{ ...REQUEST, minimized: false }} onMinimize={onMinimize} onClose={() => {}} />);
  assert.equal(instances.length, 1);
  assert.ok(view.getByText('Answer completed while minimized'));
  assert.equal((view.getByRole('textbox') as HTMLTextAreaElement).value, 'Saved follow-up');
  assert.deepEqual(panelBounds(view.getByRole('dialog')), bounds);
});

test('one click transfers completed BTW output and later answers become eligible again', async () => {
  const share = vi.spyOn(contextTransferApi, 'shareBtwIncrement').mockResolvedValue({ id: 'delivery', status: 'pending', targetSessionId: 'parent' });
  const view = render(<BtwPanel request={REQUEST} onClose={() => {}} />);
  const socket = instances[0];
  act(() => { socket.open();socket.frame({ kind: 'btw_ready' });
    socket.frame({ kind: 'btw_message', id: 'q1', role: 'user', content: 'Question' });
    socket.frame({ kind: 'btw_message', id: 'a1', role: 'assistant', content: 'Completed answer' });
    socket.frame({ kind: 'btw_status', busy: false }); });
  const button = view.getByRole('button', { name: /Send new BTW context|将 BTW 新增上下文/ });
  assert.equal((button as HTMLButtonElement).disabled, false);
  await act(async () => { fireEvent.click(button); });
  assert.deepEqual(share.mock.calls, [['window']]);
  assert.ok(view.getByText(/Attached to the parent session|已附到母会话/));
  assert.equal((button as HTMLButtonElement).disabled, true);
  act(() => { socket.frame({ kind: 'btw_message', id: 'q2', role: 'user', content: 'Follow-up' }); });
  assert.equal((button as HTMLButtonElement).disabled, true);
  act(() => { socket.frame({ kind: 'btw_message', id: 'a2', role: 'assistant', content: 'New finding' });
    socket.frame({ kind: 'btw_status', busy: false }); });
  assert.equal((button as HTMLButtonElement).disabled, false);
  await act(async () => { fireEvent.click(button); });
  assert.equal(share.mock.calls.length, 2);
});

test('the parent composer restores only its own minimized BTW window after navigation and refresh', () => {
  const props = { isActive: true, selectedProject: { projectId: 'source-project', displayName: 'Source', fullPath: '/source' },
    selectedSession: { id: 'parent', provider: 'codex' as const }, ws: null, sendMessage() {} };
  const view = render(<ChatInterface {...props} />);
  act(() => { composer.openBtw('Side question'); });
  const socket = instances[0];
  act(() => { socket.open();socket.frame({ kind: 'btw_ready' });
    socket.frame({ kind: 'btw_message', id: 'answer', role: 'assistant', content: 'Reply before hiding' }); });
  fireEvent.change(view.getByRole('textbox'), { target: { value: 'Draft before hiding' } });
  fireEvent.click(view.getByRole('button', { name: /Minimize side conversation|最小化临时对话/ }));
  assert.equal(view.queryByRole('dialog'), null);
  assert.ok(view.getByRole('button', { name: '恢复 BTW 窗口' }));
  assert.equal(JSON.parse(sessionStorage.getItem('cloudcli-btw-window')!)[0].minimized, true);
  const otherProps = { ...props, selectedSession: { id: 'other', provider: 'opencode' as const } };
  view.rerender(<ChatInterface {...otherProps} />);
  assert.equal(view.queryByRole('button', { name: '恢复 BTW 窗口' }), null);
  act(() => { socket.frame({ kind: 'btw_message', id: 'answer', role: 'assistant', content: 'Reply during navigation' }); });
  view.rerender(<ChatInterface {...props} />);
  assert.ok(view.getByRole('button', { name: '恢复 BTW 窗口' }));
  assert.equal(socket.readyState, FakeSocket.OPEN);
  act(() => { window.dispatchEvent(new Event('pagehide')); });view.unmount();

  const restored = render(<ChatInterface {...props} />);
  assert.equal(restored.queryByRole('dialog'), null);
  assert.ok(restored.getByRole('button', { name: '恢复 BTW 窗口' }));
  const resumed = instances[1];
  act(() => { resumed.open();resumed.frame({ kind: 'btw_ready' });
    resumed.frame({ kind: 'btw_message', id: 'answer', role: 'assistant', content: 'Reply after refresh' }); });
  assert.equal(resumed.sent[0].type, 'resume');
  fireEvent.click(restored.getByRole('button', { name: '恢复 BTW 窗口' }));
  assert.ok(restored.getByText('Reply after refresh'));
  assert.equal((restored.getByRole('textbox') as HTMLTextAreaElement).value, 'Draft before hiding');
  assert.equal(instances.length, 2);
});

test('BTW streams one row per native item, accepts a follow-up and cleans up on close', async () => {
  const onClose = vi.fn();const view = render(<BtwPanel request={REQUEST} onClose={onClose} />);
  const socket = instances[0];assert.ok(socket.url.includes('/btw'));
  await act(async () => { socket.open();socket.frame({ kind: 'btw_ready' });
    socket.frame({ kind: 'btw_message', id: 'question', role: 'user', content: 'Initial side question' });
    socket.frame({ kind: 'btw_message', id: 'answer', role: 'assistant', content: 'A streamed' });
    socket.frame({ kind: 'btw_message', id: 'answer', role: 'assistant', content: 'A streamed answer' });
    socket.frame({ kind: 'btw_status', busy: false }); });
  assert.equal(socket.sent[0].sessionId, 'parent');assert.equal(socket.sent[0].question, REQUEST.question);
  assert.equal(view.getByRole('dialog').querySelectorAll('[data-btw-message="assistant"]').length, 1);
  assert.ok(view.getByText('A streamed answer'));
  fireEvent.change(view.getByRole('textbox'), { target: { value: 'Follow-up question' } });
  fireEvent.submit(view.getByRole('dialog').querySelector('form')!);
  assert.deepEqual(socket.sent.at(-1), { type: 'send', content: 'Follow-up question' });
  fireEvent.click(view.getByRole('button', { name: /Stop|停止/ }));assert.equal(socket.sent.at(-1).type, 'stop');
  fireEvent.keyDown(view.getByRole('textbox'), { key: 'Escape' });assert.equal(onClose.mock.calls.length, 1);
  view.unmount();assert.equal(socket.sent.at(-1).type, 'finish');assert.equal(socket.readyState, FakeSocket.CLOSED);
});

test('closing during connection setup releases the socket without starting a fork', async () => {
  const view = render(<BtwPanel request={REQUEST} onClose={() => {}} />);const socket = instances[0];
  view.unmount();socket.open();assert.equal(socket.readyState, FakeSocket.CLOSED);assert.deepEqual(socket.sent, []);
});

test('a lost socket reconnects to the existing fork and retains the reply and unsent draft', async () => {
  vi.useFakeTimers();
  const view = render(<BtwPanel request={REQUEST} onClose={() => {}} />);const socket = instances[0];
  await act(async () => { socket.open();socket.frame({ kind: 'btw_ready' });
    socket.frame({ kind: 'btw_message', id: 'answer', role: 'assistant', content: 'Saved in the window' }); });
  fireEvent.change(view.getByRole('textbox'), { target: { value: 'Unsent follow-up' } });
  act(() => { socket.close(); });
  assert.ok(view.getByText('Saved in the window'));
  assert.ok(view.getByText(/Reconnecting side conversation|正在恢复临时对话连接/));
  act(() => { vi.advanceTimersByTime(500); });
  const resumed = instances[1];act(() => { resumed.open(); });
  assert.deepEqual(resumed.sent[0], { type: 'resume', conversationId: REQUEST.key });
  act(() => { resumed.frame({ kind: 'btw_ready' });resumed.frame({ kind: 'btw_message', id: 'answer', role: 'assistant', content: 'Caught up' });resumed.frame({ kind: 'btw_status', busy: false }); });
  assert.equal(view.getByRole('dialog').querySelectorAll('[data-btw-message="assistant"]').length, 1);
  assert.ok(view.getByText('Caught up'));
  assert.equal((view.getByRole('textbox') as HTMLTextAreaElement).value, 'Unsent follow-up');
  assert.equal(socket.sent.some(message => message.type === 'finish'), false);
});

test('OpenCode forwards its Go selection and displays provider phases with elapsed time', async () => {
  vi.useFakeTimers();
  const view = render(<BtwPanel request={{ ...REQUEST, provider: 'opencode', model: 'opencode-go/glm-5.3-flash', permissionMode: 'bypassPermissions' }} onClose={() => {}} />);
  const socket = instances[0];
  await act(async () => { socket.open();socket.frame({ kind: 'btw_ready' });socket.frame({ kind: 'btw_status', busy: true, phase: 'compacting' });vi.advanceTimersByTime(3000); });
  assert.equal(socket.sent[0].model, 'opencode-go/glm-5.3-flash');assert.equal(socket.sent[0].permissionMode, 'bypassPermissions');
  assert.ok(view.getByText(/压缩|Compacting/));assert.ok(view.getByText('3s'));
  await act(async () => { socket.frame({ kind: 'btw_status', busy: false }); });
  fireEvent.change(view.getByRole('textbox'), { target: { value: 'Follow up' } });
  fireEvent.submit(view.getByRole('dialog').querySelector('form')!);
  assert.ok(view.getByText('0s'));
  assert.ok(view.getByText(/等待|Waiting/));
});

function mockPanelBounds(panel: HTMLElement) {
  vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(() => ({
    left: parseFloat(panel.style.left) || 500, top: parseFloat(panel.style.top) || 180,
    width: parseFloat(panel.style.width) || 480, height: parseFloat(panel.style.height) || 544,
  } as DOMRect));
}
function panelBounds(panel: HTMLElement) {
  return ['left', 'top', 'width', 'height'].map(key => parseFloat(panel.style[key as 'left' | 'top' | 'width' | 'height']));
}

test.each([
  ['n', 0, -40, [500, 140, 480, 584]], ['s', 0, 40, [500, 180, 480, 584]],
  ['w', -60, 0, [440, 180, 540, 544]], ['e', 60, 0, [500, 180, 540, 544]],
  ['nw', -60, -40, [440, 140, 540, 584]], ['ne', 60, -40, [500, 140, 540, 584]],
  ['sw', -60, 40, [440, 180, 540, 584]], ['se', 60, 40, [500, 180, 540, 584]],
] as const)('dragging the %s handle resizes just its edges', (direction, dx, dy, expected) => {
  const view = render(<BtwPanel request={REQUEST} onClose={() => {}} />);
  const panel = view.getByRole('dialog');mockPanelBounds(panel);
  fireEvent.pointerDown(panel.querySelector(`[data-btw-resize="${direction}"]`)!, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy });
  assert.deepEqual(panelBounds(panel), [...expected]);
  fireEvent.pointerUp(window, { pointerId: 1 });assert.equal(document.body.style.userSelect, '');
});

test('pointer resizing respects minimum size, screen bounds and pointer cancellation', () => {
  const view = render(<BtwPanel request={REQUEST} onClose={() => {}} />);
  const panel = view.getByRole('dialog');mockPanelBounds(panel);
  const corner = panel.querySelector('[data-btw-resize="nw"]')!;
  fireEvent.pointerDown(corner, { pointerId: 7, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(window, { pointerId: 8, clientX: 9999, clientY: 9999 });assert.equal(panel.style.left, '');
  fireEvent.pointerMove(window, { pointerId: 7, clientX: 9999, clientY: 9999 });
  assert.deepEqual(panelBounds(panel), [660, 464, 320, 260]);
  fireEvent.pointerMove(window, { pointerId: 7, clientX: -9999, clientY: -9999 });
  assert.deepEqual(panelBounds(panel), [8, 8, 972, 716]);
  fireEvent.pointerCancel(window, { pointerId: 7 });assert.equal(document.body.style.userSelect, '');
  fireEvent.pointerMove(window, { pointerId: 7, clientX: 200, clientY: 200 });
  assert.deepEqual(panelBounds(panel), [8, 8, 972, 716]);
  fireEvent.pointerDown(corner, { pointerId: 9, button: 0 });
  view.unmount();assert.equal(document.body.style.userSelect, '');
});

test('keyboard resizing fits a smaller visual viewport and restores the preferred size afterward', () => {
  const viewport = Object.assign(new EventTarget(), { offsetLeft: 0, offsetTop: 0, width: 1200, height: 900 });
  vi.stubGlobal('visualViewport', viewport);
  const view = render(<BtwPanel request={REQUEST} onClose={() => {}} />);
  const panel = view.getByRole('dialog');mockPanelBounds(panel);
  const corner = panel.querySelector('[data-btw-resize="nw"]')!;
  fireEvent.keyDown(corner, { key: 'ArrowLeft' });
  fireEvent.keyDown(corner, { key: 'ArrowUp', shiftKey: true });
  assert.deepEqual(panelBounds(panel), [490, 140, 490, 584]);
  act(() => { viewport.width = 390;viewport.height = 350;viewport.offsetTop = 60;viewport.dispatchEvent(new Event('resize')); });
  assert.deepEqual(panelBounds(panel), [8, 68, 374, 334]);
  act(() => { viewport.width = 1200;viewport.height = 900;viewport.offsetTop = 0;viewport.dispatchEvent(new Event('resize')); });
  assert.deepEqual(panelBounds(panel), [490, 140, 490, 584]);
});

test('sidebar navigation shows each source session’s own BTW window, draft, stream and size', () => {
  const props = { isActive: true, selectedProject: { projectId: 'source-project', displayName: 'Source', fullPath: '/source' },
    selectedSession: { id: 'parent', provider: 'codex' as const }, ws: null, sendMessage() {} };
  const view = render(<ChatInterface {...props} />);
  act(() => { composer.openBtw('Side question from the original session'); });
  const panel = view.getByRole('dialog');mockPanelBounds(panel);
  const socket = instances[0];
  act(() => { socket.open();socket.frame({ kind: 'btw_ready' });
    socket.frame({ kind: 'btw_message', id: 'answer', role: 'assistant', content: 'Still streaming' }); });
  fireEvent.change(view.getByRole('textbox'), { target: { value: 'Keep this draft' } });
  fireEvent.keyDown(panel.querySelector('[data-btw-resize="nw"]')!, { key: 'ArrowLeft' });
  const bounds = panelBounds(panel);
  const otherProps = { ...props, selectedProject: { projectId: 'another-project', displayName: 'Other', fullPath: '/other' },
    selectedSession: { id: 'other', provider: 'opencode' as const } };
  view.rerender(<ChatInterface {...otherProps} />);
  assert.equal(Boolean(view.queryByRole('dialog')), false);assert.equal(instances.length, 1);assert.equal(socket.readyState, FakeSocket.OPEN);
  assert.equal(socket.sent[0].sessionId, 'parent');
  assert.equal(socket.sent[0].model, 'gpt-6.1-sol');assert.equal(socket.sent.some(message => message.type === 'finish'), false);
  act(() => { socket.frame({ kind: 'btw_message', id: 'answer', role: 'assistant', content: 'The reply continues after navigation' });
    socket.frame({ kind: 'btw_status', busy: false }); });
  act(() => { composer.openBtw('Question in the other session'); });
  const otherSocket = instances[1];act(() => { otherSocket.open();otherSocket.frame({ kind: 'btw_ready' });
    otherSocket.frame({ kind: 'btw_message', id: 'answer', role: 'assistant', content: 'Independent OpenCode reply' });
    otherSocket.frame({ kind: 'btw_status', busy: false }); });
  fireEvent.change(view.getByRole('textbox'), { target: { value: 'Independent OpenCode draft' } });
  assert.equal(otherSocket.sent[0].sessionId, 'other');assert.equal(otherSocket.sent[0].model, 'opencode-go/glm-5.3-flash');
  assert.equal(view.getByText('Independent OpenCode reply').dataset.markdownProject, 'another-project');
  assert.equal(Boolean(view.queryByText('The reply continues after navigation')), false);
  view.rerender(<ChatInterface {...props} />);
  assert.equal((view.getByRole('textbox') as HTMLTextAreaElement).value, 'Keep this draft');
  assert.deepEqual(panelBounds(view.getByRole('dialog')), bounds);assert.equal(instances.length, 2);
  assert.equal(view.getByText('The reply continues after navigation').dataset.markdownProject, 'source-project');
  fireEvent.submit(view.getByRole('dialog').querySelector('form')!);assert.deepEqual(socket.sent.at(-1), { type: 'send', content: 'Keep this draft' });
  view.rerender(<ChatInterface {...otherProps} />);
  assert.equal((view.getByRole('textbox') as HTMLTextAreaElement).value, 'Independent OpenCode draft');
  fireEvent.click(view.getByRole('button', { name: /Close side conversation|关闭临时对话/ }));
  assert.equal(otherSocket.sent.at(-1).type, 'finish');assert.equal(otherSocket.readyState, FakeSocket.CLOSED);
  assert.equal(socket.readyState, FakeSocket.OPEN);assert.equal(socket.sent.some(message => message.type === 'finish'), false);
  view.rerender(<ChatInterface {...props} />);
  assert.ok(view.getByText('The reply continues after navigation'));
  fireEvent.click(view.getByRole('button', { name: /Close side conversation|关闭临时对话/ }));
  assert.equal(view.queryByRole('dialog'), null);assert.equal(socket.sent.at(-1).type, 'finish');assert.equal(socket.readyState, FakeSocket.CLOSED);
});

test.each(['codex', 'opencode'] as const)('refresh restores the %s BTW window, original context, transcript, draft and preferred size', provider => {
  const props = { isActive: true, selectedProject: { projectId: 'source-project', displayName: 'Source', fullPath: '/source' },
    selectedSession: { id: 'parent', provider }, ws: null, sendMessage() {} };
  const first = render(<ChatInterface {...props} />);
  act(() => { composer.openBtw('Ask this once'); });
  const panel = first.getByRole('dialog');mockPanelBounds(panel);
  const socket = instances[0];
  act(() => { socket.open();socket.frame({ kind: 'btw_attached' });socket.frame({ kind: 'btw_ready' });
    socket.frame({ kind: 'btw_message', id: 'q', role: 'user', content: 'Ask this once' });
    socket.frame({ kind: 'btw_message', id: 'a', role: 'assistant', content: 'Answer before refresh' }); });
  fireEvent.change(first.getByRole('textbox'), { target: { value: 'Draft across refresh' } });
  fireEvent.keyDown(panel.querySelector('[data-btw-resize="nw"]')!, { key: 'ArrowLeft' });
  const bounds = panelBounds(panel);
  act(() => { window.dispatchEvent(new Event('pagehide')); });first.unmount();
  assert.equal(socket.sent.some(message => message.type === 'finish'), false);
  const restored = render(<ChatInterface {...props} selectedProject={{ projectId: 'different-project', displayName: 'Other', fullPath: '/other' }}
    selectedSession={{ id: 'different-session', provider: 'codex' }} />);
  assert.equal(Boolean(restored.queryByRole('dialog')), false);
  restored.rerender(<ChatInterface {...props} />);
  assert.ok(restored.getByText('Answer before refresh'));
  assert.equal((restored.getByRole('textbox') as HTMLTextAreaElement).value, 'Draft across refresh');
  assert.deepEqual(panelBounds(restored.getByRole('dialog')), bounds);
  const resumed = instances[1];act(() => { resumed.open(); });
  assert.deepEqual(resumed.sent[0], { type: 'resume', conversationId: socket.sent[0].conversationId });
  act(() => { resumed.frame({ kind: 'btw_ready' });resumed.frame({ kind: 'btw_message', id: 'a', role: 'assistant', content: 'Answer completed during refresh' });
    resumed.frame({ kind: 'btw_status', busy: false }); });
  assert.equal(restored.getByRole('dialog').querySelectorAll('[data-btw-message="assistant"]').length, 1);
  assert.equal(restored.getByText('Answer completed during refresh').dataset.markdownProject, 'source-project');
  fireEvent.submit(restored.getByRole('dialog').querySelector('form')!);
  assert.deepEqual(resumed.sent.at(-1), { type: 'send', content: 'Draft across refresh' });
  fireEvent.click(restored.getByRole('button', { name: /Close side conversation|关闭临时对话/ }));
  assert.equal(resumed.sent.at(-1).type, 'finish');assert.equal(sessionStorage.getItem('cloudcli-btw-window'), null);
  restored.unmount();const closed = render(<ChatInterface {...props} />);assert.equal(closed.queryByRole('dialog'), null);
});

test('refresh resumes both sessions while showing only the selected source and its draft', () => {
  const props = { isActive: true, selectedProject: { projectId: 'source-project', displayName: 'Source', fullPath: '/source' },
    selectedSession: { id: 'parent', provider: 'codex' as const }, ws: null, sendMessage() {} };
  const otherProps = { ...props, selectedSession: { id: 'other', provider: 'opencode' as const } };
  const first = render(<ChatInterface {...props} />);
  act(() => { composer.openBtw('Codex question'); });
  act(() => { instances[0].open();instances[0].frame({ kind: 'btw_ready' }); });
  fireEvent.change(first.getByRole('textbox'), { target: { value: 'Codex draft' } });
  first.rerender(<ChatInterface {...otherProps} />);
  act(() => { composer.openBtw('OpenCode question'); });
  act(() => { instances[1].open();instances[1].frame({ kind: 'btw_ready' }); });
  fireEvent.change(first.getByRole('textbox'), { target: { value: 'OpenCode draft' } });
  const conversationIds = instances.map(socket => socket.sent[0].conversationId);
  act(() => { window.dispatchEvent(new Event('pagehide')); });first.unmount();
  const restored = render(<ChatInterface {...props} />);
  assert.equal((restored.getByRole('textbox') as HTMLTextAreaElement).value, 'Codex draft');
  act(() => { instances[2].open();instances[3].open(); });
  assert.deepEqual(instances.slice(2).map(socket => socket.sent[0]), conversationIds.map(conversationId => ({ type: 'resume', conversationId })));
  restored.rerender(<ChatInterface {...otherProps} />);
  assert.equal((restored.getByRole('textbox') as HTMLTextAreaElement).value, 'OpenCode draft');
  restored.rerender(<ChatInterface {...otherProps} isActive={false} />);
  assert.equal(Boolean(restored.queryByRole('dialog')), false);
  assert.ok(instances.every(socket => socket.sent.every(message => message.type !== 'finish')));
});

test('the previous single-window checkpoint migrates to its source session', () => {
  sessionStorage.setItem('cloudcli-btw-window', JSON.stringify(REQUEST));
  const props = { isActive: true, selectedProject: { projectId: 'source-project', displayName: 'Source', fullPath: '/source' },
    selectedSession: { id: 'other', provider: 'codex' as const }, ws: null, sendMessage() {} };
  const view = render(<ChatInterface {...props} />);
  assert.equal(Boolean(view.queryByRole('dialog')), false);
  assert.deepEqual(JSON.parse(sessionStorage.getItem('cloudcli-btw-window')!), [{ ...REQUEST, resumeOnly: true }]);
  view.rerender(<ChatInterface {...props} selectedSession={{ id: REQUEST.sessionId, provider: 'codex' }} />);
  assert.ok(view.getByRole('dialog'));assert.equal(instances.length, 1);
  act(() => { instances[0].open(); });assert.deepEqual(instances[0].sent[0], { type: 'resume', conversationId: REQUEST.key });
});

test.each(['codex', 'opencode'] as const)('leaving and returning to the workspace resumes the %s fork with its answer and draft', provider => {
  const props = { isActive: true, selectedProject: { projectId: 'project', fullPath: '/source', displayName: 'Source' },
    selectedSession: { id: 'parent', provider }, ws: null, sendMessage() {} };
  const first = render(<ChatInterface {...props} />);
  act(() => { composer.openBtw('Ask exactly once'); });
  act(() => { instances[0].open();instances[0].frame({ kind: 'btw_ready' });
    instances[0].frame({ kind: 'btw_message', id: 'answer', role: 'assistant', content: 'Retained answer' }); });
  fireEvent.change(first.getByRole('textbox'), { target: { value: 'Retained draft' } });
  const id = instances[0].sent[0].conversationId;
  first.unmount();
  assert.equal(instances[0].sent.some(message => message.type === 'finish'), false);
  assert.ok(sessionStorage.getItem(`cloudcli-btw-conversation:${id}`));
  const restored = render(<ChatInterface {...props} />);
  assert.ok(restored.getByText('Retained answer'));assert.equal((restored.getByRole('textbox') as HTMLTextAreaElement).value, 'Retained draft');
  act(() => { instances[1].open(); });
  assert.deepEqual(instances[1].sent[0], { type: 'resume', conversationId: id });
  fireEvent.click(restored.getByRole('button', { name: /Close side conversation|关闭临时对话/ }));
  assert.equal(instances[1].sent.at(-1).type, 'finish');
  assert.equal(sessionStorage.getItem(`cloudcli-btw-conversation:${id}`), null);
  assert.equal(sessionStorage.getItem('cloudcli-btw-window'), null);
});

test('navigation before the first server acknowledgement preserves the submitted window identity', () => {
  const first = render(<BtwPanel request={REQUEST} onClose={() => {}} />);
  act(() => { instances[0].open(); });first.unmount();
  render(<BtwPanel request={REQUEST} onClose={() => {}} />);act(() => { instances[1].open(); });
  assert.equal(instances[0].sent[0].type, 'start');
  assert.deepEqual(instances[1].sent[0], { type: 'resume', conversationId: REQUEST.key });
});

test('replacing a source window explicitly finishes the old fork before starting the new question', () => {
  const props = { isActive: true, selectedProject: { projectId: 'project', fullPath: '/source', displayName: 'Source' },
    selectedSession: { id: 'parent', provider: 'codex' as const }, ws: null, sendMessage() {} };
  render(<ChatInterface {...props} />);
  act(() => { composer.openBtw('First question'); });
  act(() => { instances[0].open();instances[0].frame({ kind: 'btw_ready' }); });
  const oldId = instances[0].sent[0].conversationId;
  act(() => { composer.openBtw('Replacement question'); });
  act(() => { instances[1].open(); });
  assert.equal(instances[0].sent.at(-1).type, 'finish');assert.equal(instances[0].readyState, FakeSocket.CLOSED);
  assert.equal(sessionStorage.getItem(`cloudcli-btw-conversation:${oldId}`), null);
  assert.equal(instances[1].sent[0].type, 'start');assert.equal(instances[1].sent[0].question, 'Replacement question');
});

test('a server-expired fork displays its saved answer and error without replaying the question', () => {
  const view = render(<BtwPanel request={REQUEST} onClose={() => {}} />);const socket = instances[0];
  act(() => { socket.open();socket.frame({ kind: 'btw_ready' });socket.frame({ kind: 'btw_message', id: 'a', role: 'assistant', content: 'Preserve this answer' });
    window.dispatchEvent(new Event('pagehide')); });view.unmount();
  const restored = render(<BtwPanel request={REQUEST} onClose={() => {}} />);const next = instances[1];
  act(() => { next.open();next.frame({ kind: 'btw_error', message: 'Temporary conversation expired' });next.frame({ kind: 'btw_closed' }); });
  assert.ok(restored.getByText('Preserve this answer'));assert.ok(restored.getByRole('alert'));
  assert.equal((restored.getByRole('textbox') as HTMLTextAreaElement).disabled, true);
  assert.equal(next.sent[0].type, 'resume');assert.equal(next.sent.some(message => message.type === 'start'), false);
});
