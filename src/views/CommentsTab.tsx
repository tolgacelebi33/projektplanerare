import { useMemo, useRef, useState } from "react";
import { logStamp } from "../data/extras";
import type { DataStore } from "../data/DataStore";
import type { Comment, User } from "../data/types";
import { COMMENT_LIMITS } from "../data/types";
import { friendlyError } from "../i18n/errors";
import { sv } from "../i18n/sv";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Text med @namn markerade (bara namn som finns som personer). */
export function MentionText({ text, users }: { text: string; users: User[] }) {
  const parts = useMemo(() => {
    const names = [...users.map((u) => u.name)].filter(Boolean).sort((a, b) => b.length - a.length);
    if (!names.length) return [text];
    return text.split(new RegExp(`(@(?:${names.map(esc).join("|")}))(?![\\p{L}\\p{N}])`, "giu"));
  }, [text, users]);
  return <>{parts.map((p, i) => (i % 2 === 1 ? <mark key={i} className="mention">{p}</mark> : <span key={i}>{p}</span>))}</>;
}

/**
 * Kommentarsvägg för en post: nyaste överst, svar under (en nivå), @namn, redigera och ta bort. Kommentarerna ligger utanför ångra-historiken.
 * Alla kommentarer kan ändras på den här enheten (det finns inga konton än), så "Skriv som" är ett val, inte en inloggning.
 */
export function CommentsTab({ store, itemId, comments, users, me, onMe }: { store: DataStore; itemId: string; comments: Comment[]; users: User[]; me: string; onMe: (id: string) => void }) {
  const t = sv.comments;
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const mine = comments.filter((c) => c.item_id === itemId);
  const top = mine.filter((c) => !c.parent_id).sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const repliesOf = (id: string) => mine.filter((c) => c.parent_id === id).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const author = users.some((u) => u.id === me) ? me : users[0]?.id ?? "";
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); setError(null); return true; } catch (e) { setError(friendlyError(e)); return false; } };
  const post = async (value: string, parent: string | null) => run(() => store.addComment({ item_id: itemId, text: value, author_id: author || null, parent_id: parent }));
  const mention = (name: string) => {
    const el = area.current; if (!el || !name) return;
    const at = el.selectionStart ?? text.length;
    const next = `${text.slice(0, at)}${at > 0 && !/\s$/.test(text.slice(0, at)) ? " " : ""}@${name} ${text.slice(at)}`;
    setText(next); el.focus();
  };
  const who = (c: Comment) => users.find((u) => u.id === c.author_id)?.name ?? (c.author_name || t.unknown);
  const item = (c: Comment, reply: boolean) => (
    <li key={c.id} className={reply ? "comment reply" : "comment"} data-comment={c.id}>
      <div className="comment-head">
        <strong>{who(c)}</strong>
        <time dateTime={c.created_at}>{logStamp(c.created_at)}</time>
        {c.edited_at && <span className="panel-muted">{t.edited}</span>}
      </div>
      {editing?.id === c.id ? (
        <div className="comment-edit">
          <textarea aria-label={t.editLabel} rows={3} value={editing.text} maxLength={COMMENT_LIMITS.text} onChange={(e) => setEditing({ id: c.id, text: e.target.value })} />
          <div className="panel-row">
            <button type="button" className="mini mini-primary" onClick={() => void run(() => store.editComment(c.id, editing.text)).then((ok) => ok && setEditing(null))}>{t.save}</button>
            <button type="button" className="mini" onClick={() => { setEditing(null); setError(null); }}>{t.cancel}</button>
          </div>
        </div>
      ) : (
        <p className="comment-text"><MentionText text={c.text} users={users} /></p>
      )}
      {confirm === c.id ? (
        <div className="panel-confirm" role="group" aria-label={t.confirmDelete(repliesOf(c.id).length)}>
          <span>{t.confirmDelete(repliesOf(c.id).length)}</span>
          <button type="button" className="mini mini-danger" onClick={() => void run(() => store.deleteComment(c.id)).then(() => setConfirm(null))}>{t.deleteYes}</button>
          <button type="button" className="mini" onClick={() => setConfirm(null)}>{t.cancel}</button>
        </div>
      ) : editing?.id !== c.id && (
        <div className="comment-actions">
          {!reply && <button type="button" className="panel-link" onClick={() => { setReplyTo(replyTo === c.id ? null : c.id); setReplyText(""); setError(null); }}>{t.reply}</button>}
          <button type="button" className="panel-link" onClick={() => { setEditing({ id: c.id, text: c.text }); setError(null); }}>{t.edit}</button>
          <button type="button" className="panel-link" onClick={() => setConfirm(c.id)}>{t.remove}</button>
        </div>
      )}
      {!reply && replyTo === c.id && (
        <div className="comment-edit">
          <textarea aria-label={t.replyLabel(who(c))} rows={2} value={replyText} maxLength={COMMENT_LIMITS.text} autoFocus onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void post(replyText, c.id).then((ok) => { if (ok) { setReplyTo(null); setReplyText(""); } }); } }} />
          <div className="panel-row">
            <button type="button" className="mini mini-primary" disabled={!replyText.trim()} onClick={() => void post(replyText, c.id).then((ok) => { if (ok) { setReplyTo(null); setReplyText(""); } })}>{t.sendReply}</button>
            <button type="button" className="mini" onClick={() => setReplyTo(null)}>{t.cancel}</button>
          </div>
        </div>
      )}
      {!reply && repliesOf(c.id).length > 0 && <ul className="comment-replies">{repliesOf(c.id).map((r) => item(r, true))}</ul>}
    </li>
  );
  return (
    <section className="panel-section comments" data-section="comments">
      <div className="comment-compose">
        {users.length > 0 && (
          <label className="panel-field"><span>{t.writeAs}</span>
            <select name="comment-as" value={author} onChange={(e) => onMe(e.target.value)}>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select></label>
        )}
        <textarea ref={area} name="comment-new" rows={3} value={text} maxLength={COMMENT_LIMITS.text} placeholder={t.placeholder} aria-label={t.newLabel}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void post(text, null).then((ok) => ok && setText("")); } }} />
        <div className="panel-row">
          <button type="button" className="mini mini-primary" disabled={!text.trim()} onClick={() => void post(text, null).then((ok) => ok && setText(""))}>{t.send}</button>
          {users.length > 0 && (
            <select aria-label={t.mention} value="" onChange={(e) => { mention(e.target.value); e.target.value = ""; }}>
              <option value="">{t.mention}</option>
              {users.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
            </select>
          )}
          <span className="panel-muted comment-hint">{t.hint}</span>
        </div>
      </div>
      {error && <p role="alert" className="panel-error">{error}</p>}
      {top.length === 0 ? <p className="panel-muted">{t.empty}</p> : <ul className="comment-list">{top.map((c) => item(c, false))}</ul>}
    </section>
  );
}
