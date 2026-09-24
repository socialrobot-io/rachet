import { Loader2, Mail } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { formatWhen } from '@/flow';

export type EmailPreview =
  | { kind: 'loading'; title: string }
  | { kind: 'error'; title: string; message: string }
  | {
      kind: 'ready';
      title: string;
      subject: string;
      html: string;
      recipient?: string | undefined;
      state?: string | undefined;
      sentAt?: string | null | undefined;
      note?: string | undefined;
    };

/**
 * Side panel showing an email: the stored sent message when one exists, or a
 * sample-rendered template otherwise. The HTML renders in a sandboxed iframe
 * (no scripts, no same-origin access).
 */
export function EmailPreviewSheet({
  preview,
  onClose,
}: {
  preview: EmailPreview | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={preview !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:w-[min(56rem,calc(100vw-4rem))] sm:max-w-none">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Mail className="size-4 text-muted-foreground" />
            {preview?.title ?? 'Email'}
          </SheetTitle>
          {preview?.kind === 'ready' && (
            <SheetDescription className="flex flex-col gap-0.5 text-left">
              <span className="font-medium text-foreground">{preview.subject}</span>
              <span className="font-mono text-xs">
                {[
                  preview.recipient ? `to ${preview.recipient}` : null,
                  preview.state,
                  preview.sentAt ? `sent ${formatWhen(preview.sentAt)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {preview.note && <span className="text-xs">{preview.note}</span>}
            </SheetDescription>
          )}
        </SheetHeader>
        <div className="min-h-0 flex-1 bg-muted/40">
          {preview?.kind === 'loading' && (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Rendering preview…
            </div>
          )}
          {preview?.kind === 'error' && (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
              {preview.message}
            </div>
          )}
          {preview?.kind === 'ready' && (
            <iframe
              title={preview.subject}
              sandbox=""
              srcDoc={preview.html}
              className="h-full w-full border-0 bg-white"
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
