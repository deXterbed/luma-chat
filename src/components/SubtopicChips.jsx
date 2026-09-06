import { MessageSquarePlus } from "lucide-react";
import styles from "./SubtopicChips.module.css";

// Render clickable follow-up chips for an assistant message. `subtopics` is
// the array set on the message by the dedicated follow-up call
// (see src/lib/followups.js + useStreamingChat) — transient, not persisted.
// Clicking a chip sends its `prompt` as the next user message in the current
// pane via `onFollowUp` (null while the pane is streaming → chips disabled).
export default function SubtopicChips({ subtopics, onFollowUp }) {
  if (!Array.isArray(subtopics) || subtopics.length === 0) return null;

  return (
    <div className={styles.chips}>
      {subtopics.map((s, i) => (
        <button
          key={i}
          type="button"
          className={styles.chip}
          disabled={!onFollowUp}
          title={s.prompt}
          onClick={() => onFollowUp?.(s.prompt)}
        >
          <MessageSquarePlus size={12} className={styles.chipIcon} />
          <span className={styles.chipLabel}>{s.title || s.prompt}</span>
        </button>
      ))}
    </div>
  );
}