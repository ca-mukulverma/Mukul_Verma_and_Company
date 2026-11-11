"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { DEFAULT_QUICK_COMMENTS } from "@/lib/task-views";

// A small comment box with one-click comments, used on the task cards, in the
// bell and on Today, so a task can be followed up without opening it.

// The quick comments are loaded once per page load and shared by every box
let quickCommentsRequest: Promise<string[]> | null = null;
export function loadQuickComments(force = false) {
  if (!quickCommentsRequest || force) {
    quickCommentsRequest = axios
      .get<{ comments: string[] }>("/api/tasks/quick-comments")
      .then(({ data }) => data.comments)
      .catch(() => {
        quickCommentsRequest = null;
        return DEFAULT_QUICK_COMMENTS;
      });
  }
  return quickCommentsRequest;
}

export function useQuickComments() {
  const [comments, setComments] = useState<string[]>(DEFAULT_QUICK_COMMENTS);
  useEffect(() => {
    let active = true;
    loadQuickComments().then((c) => active && setComments(c));
    return () => {
      active = false;
    };
  }, []);
  return comments;
}

export interface SentComment {
  id: string;
  content: string;
  createdAt: string;
  user: { id: string; name: string };
}

export function QuickReply({
  taskId,
  onSent,
  showChips = true,
  showText = true,
  // Followers' comments ask for a reply; they can say no reply is needed
  canAskReply = false,
  autoFocus = false,
  className,
}: {
  taskId: string;
  onSent?: (comment: SentComment) => void;
  showChips?: boolean;
  showText?: boolean;
  canAskReply?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const quick = useQuickComments();
  const [text, setText] = useState("");
  const [noReplyNeeded, setNoReplyNeeded] = useState(false);
  const [sending, setSending] = useState<string | null>(null);

  const send = async (content: string) => {
    const value = content.trim();
    if (!value || sending) return;
    setSending(value);
    try {
      const { data } = await axios.post<SentComment & { replyRequested?: boolean }>(`/api/tasks/${taskId}/comments`, {
        content: value,
        ...(canAskReply && noReplyNeeded ? { noReplyNeeded: true } : {}),
      });
      if (value === text.trim()) setText("");
      toast.success(data.replyRequested ? "Sent – a reply is asked for" : "Sent");
      onSent?.(data);
    } catch {
      toast.error("Couldn't send the comment");
    } finally {
      setSending(null);
    }
  };

  return (
    <div className={cn("space-y-2", className)} onClick={(e) => e.stopPropagation()}>
      {showChips && (
        <div className="flex flex-wrap gap-1">
          {quick.map((q) => (
            <Button
              key={q}
              type="button"
              size="sm"
              variant="outline"
              className="h-7 rounded-full px-2.5 text-xs"
              disabled={!!sending}
              onClick={() => send(q)}
            >
              {sending === q && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              {q}
            </Button>
          ))}
        </div>
      )}
      {showText && (
        <form
          className="flex items-end gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
        >
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(text);
              }
            }}
            placeholder="Write a reply…"
            rows={1}
            maxLength={5000}
            autoFocus={autoFocus}
            className="min-h-9 resize-none py-1.5 text-sm"
          />
          <Button type="submit" size="icon" className="h-9 w-9 shrink-0" disabled={!text.trim() || !!sending} aria-label="Send">
            {sending && sending === text.trim() ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      )}
      {canAskReply && (
        <label className="flex w-fit cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox checked={noReplyNeeded} onCheckedChange={(v) => setNoReplyNeeded(v === true)} />
          No reply needed
        </label>
      )}
    </div>
  );
}
