import { getConnection } from '@/modules/database/connection.js';
import type { NoteSessionContext, OutputNote, OutputNoteFilter } from '@/shared/index.js';

function decode(row: unknown): OutputNote | null { return row ? JSON.parse((row as { payload: string }).payload) : null; }

function where(userId: number, search: string, filter: OutputNoteFilter = {}) {
  const pattern = `%${search.replace(/[\\%_]/g, value => `\\${value}`)}%`;
  const clauses = ["user_id = ? AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' OR json_extract(payload, '$.sourceTitle') LIKE ? ESCAPE '\\')"];
  const values: Array<string | number> = [userId, pattern, pattern, pattern];
  if (filter.sourceSessionId) { clauses.push("json_extract(payload, '$.sourceSessionId') = ?");values.push(filter.sourceSessionId); }
  if (filter.from) { clauses.push('created_at >= ?');values.push(filter.from); }
  if (filter.before) { clauses.push('created_at < ?');values.push(filter.before); }
  return { sql: clauses.join(' AND '), values };
}

/** Notes persists user selections; the provider gateway atomically consumes frozen initial context. */
export const notesDb = {
  create(userId: number, requestId: string, originalInput: string, note: OutputNote): void {
    getConnection().prepare('INSERT INTO output_notes (id,user_id,request_id,original_input,payload,title,content,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(note.id,userId,requestId,originalInput,JSON.stringify(note),note.title,note.content,note.createdAt,note.updatedAt);
  },
  get(userId: number, id: string): OutputNote | null { return decode(getConnection().prepare('SELECT payload FROM output_notes WHERE user_id = ? AND id = ?').get(userId,id)); },
  byRequest(userId: number, requestId: string): { note: OutputNote; originalInput: string } | null {
    const row = getConnection().prepare('SELECT payload,original_input AS originalInput FROM output_notes WHERE user_id = ? AND request_id = ?').get(userId,requestId) as { payload: string; originalInput: string } | undefined;
    return row ? { note: JSON.parse(row.payload), originalInput: row.originalInput } : null;
  },
  list(userId: number, search: string, offset: number, filter: OutputNoteFilter = {}) {
    const condition = where(userId, search, filter);
    const rows = getConnection().prepare(`SELECT payload FROM output_notes WHERE ${condition.sql} ORDER BY created_at DESC, id DESC LIMIT 51 OFFSET ?`).all(...condition.values, offset);
    return { notes: rows.slice(0,50).map(row => decode(row)!), hasMore: rows.length > 50, nextOffset: offset + Math.min(rows.length,50) };
  },
  groupingRows(userId: number, search: string) {
    const condition = where(userId, search);
    // Saved metadata remains readable after source-session archival, renaming or deletion.
    return getConnection().prepare(`SELECT json_extract(payload, '$.sourceSessionId') AS sessionId,
      json_extract(payload, '$.sourceTitle') AS title, created_at AS createdAt FROM output_notes
      WHERE ${condition.sql} ORDER BY created_at DESC, id DESC`).all(...condition.values) as Array<{ sessionId: string; title: string; createdAt: string }>;
  },
  update(userId: number, note: OutputNote, previousRevision: number): boolean {
    return getConnection().prepare('UPDATE output_notes SET title=?,content=?,payload=?,revision=?,updated_at=? WHERE user_id=? AND id=? AND revision=?')
      .run(note.title,note.content,JSON.stringify(note),note.revision,note.updatedAt,userId,note.id,previousRevision).changes > 0;
  },
  remove(userId: number, id: string): void { getConnection().prepare('DELETE FROM output_notes WHERE user_id = ? AND id = ?').run(userId,id); },
  createContext(userId: number, requestId: string, originalInput: string, sessionId: string, note: OutputNote, prompt: string): void {
    getConnection().prepare('INSERT INTO note_session_contexts (session_id,user_id,note_id,request_id,original_input,payload,prompt) VALUES (?,?,?,?,?,?,?)')
      .run(sessionId,userId,note.id,requestId,originalInput,JSON.stringify(note),prompt);
  },
  contextByRequest(userId: number, requestId: string): { sessionId: string; originalInput: string } | null {
    return getConnection().prepare('SELECT session_id AS sessionId,original_input AS originalInput FROM note_session_contexts WHERE user_id=? AND request_id=?').get(userId,requestId) as { sessionId: string; originalInput: string } || null;
  },
  context(userId: number, sessionId: string): NoteSessionContext | null {
    const row = getConnection().prepare('SELECT payload,status,error FROM note_session_contexts WHERE user_id=? AND session_id=?').get(userId,sessionId) as { payload: string; status: NoteSessionContext['status']; error: string | null } | undefined;
    return row ? { sessionId, note: JSON.parse(row.payload), status: row.status, error: row.error } : null;
  },
  claimContext(sessionId: string): Array<{ id: string; prompt: string }> {
    const db = getConnection();
    return db.transaction(() => {
      const row = db.prepare("SELECT session_id AS id,prompt FROM note_session_contexts WHERE session_id=? AND status='pending'").get(sessionId) as { id: string; prompt: string } | undefined;
      if (!row) return [];
      db.prepare("UPDATE note_session_contexts SET status='submitting' WHERE session_id=?").run(sessionId);
      return [row];
    })();
  },
  settleContext(sessionId: string, status: NoteSessionContext['status'], error: string | null = null): void {
    getConnection().prepare('UPDATE note_session_contexts SET status=?,error=? WHERE session_id=?').run(status,error,sessionId);
  },
  recover(): void { getConnection().prepare("UPDATE note_session_contexts SET status='uncertain',error='服务在初始笔记提交过程中重启，请检查会话记录。' WHERE status='submitting'").run(); },
};
