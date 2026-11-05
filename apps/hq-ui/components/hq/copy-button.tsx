"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";

/**
 * One-tap copy; for 1.5 s it reads "Đã chép" (tick, tooltip and screen reader). `label` is its accessible
 * name and tooltip; `text` shows a visible word beside the icon ("Chép" → "Đã chép").
 */
export function CopyButton({ value, label, className, text = false }: { value: string; label: string; className?: string; text?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      size={text ? "xs" : "icon-xs"}
      variant="ghost"
      aria-label={done ? "Đã chép" : label}
      title={done ? "Đã chép" : label}
      className={className}
      onClick={async () => {
        if (await copyText(value)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } else toast.error("Trình duyệt không cho chép: chọn và chép tay.");
      }}
    >
      {done ? <CheckIcon /> : <CopyIcon />}
      {text && (done ? "Đã chép" : "Chép")}
      <span role="status" className="sr-only">
        {done ? "Đã chép" : ""}
      </span>
    </Button>
  );
}
